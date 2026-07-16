import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field

from . import agent_runtime, db, governance, model_provider
from .domain import (
    FEEDBACK_TYPES,
    METRIC_DIRECTIONS,
    classify_review,
    new_id,
    next_task_state,
    now_iso,
    validate_interpretation,
    validate_task_fields,
)
from .validation import (
    contains_prompt_injection,
    redact_sensitive,
)
from .evaluation_dataset import merge_evaluation_cases

# ── Constants ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[1]
MODEL = os.getenv("ZHIPU_MODEL", "glm-4-flash")
AI_URL = os.getenv("ZHIPU_API_URL", "https://open.bigmodel.cn/api/paas/v4/chat/completions")
AI_KEY = os.getenv("ZAI_API_KEY", "")
PROMPT_VERSION = "diagnosis-v1"
SCHEMA_VERSION = "interpretation-v1"
EVALUATION_SCHEMA_VERSION = "evaluation-v1"
EVALUATION_TEMPERATURE = 0.2
AUTH_TOKEN = os.getenv("API_AUTH_TOKEN", "")
AUTH_MODE = os.getenv("AUTH_MODE", "development").lower()
AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"


def runtime_value(name, default):
    app_module = sys.modules.get("backend.app")
    return getattr(app_module, name, default) if app_module is not None else default

# ── Identity / Auth ──────────────────────────────────────────────────────────

class Identity(BaseModel):
    user_id: str
    role: str
    branches: list[str]


def identity(
    authorization: str | None = Header(default=None),
    x_user_id: str = Header(default="local-admin"),
    x_role: str = Header(default="admin"),
    x_branches: str = Header(default="*"),
    x_authenticated_user: str | None = Header(default=None),
    x_authenticated_role: str | None = Header(default=None),
    x_authenticated_branches: str | None = Header(default=None),
):
    auth_mode = runtime_value("AUTH_MODE", AUTH_MODE)
    auth_token = runtime_value("AUTH_TOKEN", AUTH_TOKEN)
    if auth_mode == "token" and authorization != f"Bearer {auth_token}":
        raise HTTPException(401, "身份认证失败")
    if auth_mode == "proxy":
        if not x_authenticated_user or not x_authenticated_role:
            raise HTTPException(401, "未收到可信身份网关信息")
        x_user_id = x_authenticated_user
        x_role = x_authenticated_role
        x_branches = x_authenticated_branches or ""
    allowed_roles = {"hq_management", "function", "region", "branch", "admin"}
    if x_role not in allowed_roles:
        raise HTTPException(403, "无效角色")
    branches = [item.strip() for item in x_branches.split(",") if item.strip()]
    return Identity(user_id=x_user_id, role=x_role, branches=branches or [])


def assert_branch(user, branch):
    if user.role in {"admin", "hq_management", "function"} or "*" in user.branches:
        return
    if branch not in user.branches:
        raise HTTPException(403, "无权访问该机构")


def assert_org(user, org_id, branch=None):
    if user.role in {"admin", "hq_management", "function"} or "*" in user.branches:
        return
    if org_id not in user.branches and (not branch or branch not in user.branches):
        raise HTTPException(403, "无权访问该机构")


def resolve_organization(branch, org_id=None):
    if org_id:
        row = db.fetch_one("SELECT * FROM organizations WHERE org_id=?", (org_id,))
        if row and db.normalize_org_name(row["name"]) != db.normalize_org_name(branch):
            raise HTTPException(422, "orgId 与机构名称不一致")
        if not row:
            timestamp = now_iso()
            try:
                db.execute(
                    """INSERT INTO organizations
                    (org_id,org_code,org_type,name,normalized_name,parent_org_id,
                     active,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        org_id, org_id, "branch", branch, db.normalize_org_name(branch),
                        None, 1, timestamp, timestamp,
                    ),
                )
            except Exception as exc:
                raise HTTPException(422, "机构名称无法唯一映射") from exc
        return org_id
    normalized = db.normalize_org_name(branch)
    rows = db.fetch_all(
        "SELECT * FROM organizations WHERE normalized_name=?", (normalized,)
    )
    if len(rows) > 1:
        raise HTTPException(409, "机构名称存在多个映射，请改用 orgId")
    if rows:
        return rows[0]["org_id"]
    generated = db.stable_org_id(branch)
    timestamp = now_iso()
    try:
        db.execute(
            """INSERT INTO organizations
            (org_id,org_code,org_type,name,normalized_name,parent_org_id,
             active,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                generated, generated, "branch", branch, normalized,
                None, 1, timestamp, timestamp,
            ),
        )
    except Exception as exc:
        raise HTTPException(422, "机构名称无法唯一映射") from exc
    return generated


# ── Audit ────────────────────────────────────────────────────────────────────

def audit(user, action, status, **kwargs):
    row = {
        "id": new_id("audit"), "action": action, "status": status,
        "user_id": user.user_id, "role": user.role,
        "created_at": now_iso(), "details": db.dump(kwargs.pop("details", {})),
        **kwargs,
    }
    columns = [
        "id", "action", "status", "user_id", "role", "org_id", "branch", "period",
        "target_id", "model", "prompt_version", "schema_version",
        "data_version", "rule_version", "latency_ms", "token_usage",
        "error_type", "details", "created_at",
    ]
    db.execute(
        f"INSERT INTO audit_logs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
        tuple(row.get(column) for column in columns),
    )


# ── Shared Pydantic Models ───────────────────────────────────────────────────

class EvidenceInput(BaseModel):
    id: str | None = None
    metric: str
    label: str
    currentValue: float | None = None
    benchmarkValue: float | None = None
    differenceValue: float | None = None
    unit: str = ""
    source: str = "dashboard"
    ruleId: str | None = None
    metricId: str | None = None
    direction: str | None = None
    benchmarkType: str | None = None
    benchmarkLabel: str | None = None
    calculationVersion: str | None = None
    rank: int | None = None
    details: dict = Field(default_factory=dict)


class DiagnosisInput(BaseModel):
    schemaVersion: str = "diagnosis-v2"
    orgId: str | None = None
    branch: str
    period: str
    dataVersion: str
    ruleVersion: str
    calculationVersion: str = "calc-v1"
    score: float = 0
    riskLevel: str
    summary: str
    riskFactors: list[dict] = Field(default_factory=list)
    facts: list[dict] = Field(default_factory=list)
    patterns: list[dict] = Field(default_factory=list)
    inferences: list[dict | str] = Field(default_factory=list)
    investigations: list[dict | str] = Field(default_factory=list)
    recommendations: list[dict | str] = Field(default_factory=list)
    attentionItems: list[dict] = Field(default_factory=list)
    configurationErrors: list[dict] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    evidence: list[EvidenceInput]


class MessageInput(BaseModel):
    diagnosisId: str
    question: str = Field(min_length=1, max_length=2000)


class FeedbackInput(BaseModel):
    targetId: str
    targetType: str
    branch: str
    period: str
    feedbackType: str
    comment: str | None = None


class EvaluationRunInput(BaseModel):
    cases: list[dict] | None = None
    datasetVersion: str = "reliability-200-v1"
    blindOnly: bool = False
    repetitions: int = Field(default=1, ge=1, le=5)


class TaskInput(BaseModel):
    diagnosisId: str
    recommendationIndex: int | None = None
    title: str
    riskMetrics: list[str] = Field(default_factory=list)
    description: str = ""
    action: str = ""
    ownerDepartment: str | None = None
    ownerName: str | None = None
    dueDate: str | None = None
    currentValue: float | None = None
    targetValue: float | None = None
    metric: str | None = None
    metricId: str | None = None
    direction: str | None = None
    evidenceIds: list[str] = Field(default_factory=list)
    bindingReason: str | None = None
    requiresEvidenceReview: bool = False
    sourceRecommendationId: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    riskMetrics: list[str] | None = None
    description: str | None = None
    action: str | None = None
    ownerDepartment: str | None = None
    ownerName: str | None = None
    dueDate: str | None = None
    currentValue: float | None = None
    targetValue: float | None = None
    status: str | None = None


class ReviewInput(BaseModel):
    diagnosisId: str


class AgentRunInput(BaseModel):
    goal: str = Field(min_length=1, max_length=2000)
    orgId: str | None = None
    branch: str | None = None
    period: str | None = None
    metricIds: list[str] = Field(default_factory=list)
    taskType: str = "analysis"
    outputFormat: str = "structured"
    riskLevel: str = "medium"
    validationPolicy: str = "strict"
    executionMode: str = "deterministic"
    idempotencyKey: str | None = None
    taskId: str | None = None


class AgentInputs(BaseModel):
    orgId: str | None = None
    branch: str | None = None
    period: str | None = None
    metricIds: list[str] | None = None
    taskId: str | None = None


class AgentMemoryInput(BaseModel):
    orgId: str
    type: str
    key: str = Field(min_length=1, max_length=120)
    payload: dict = Field(default_factory=dict)
    sourceId: str | None = None


class ShadowRunInput(BaseModel):
    agentRunId: str | None = None
    orgId: str
    branch: str
    period: str
    goal: str = Field(min_length=1, max_length=2000)
    candidateOutput: dict
    model: str | None = None
    riskLevel: str = "medium"
    validationPolicy: str = "strict"


class HumanReviewInput(BaseModel):
    targetId: str
    targetType: str
    orgId: str | None = None
    factualScore: int = Field(ge=1, le=5)
    relevanceScore: int = Field(ge=1, le=5)
    specificityScore: int = Field(ge=1, le=5)
    actionabilityScore: int = Field(ge=1, le=5)
    decision: str
    comment: str | None = None


class ReleaseGateInput(BaseModel):
    evaluationRunId: str
    datasetVersion: str = "reliability-200-v1"


# ── Prompts ──────────────────────────────────────────────────────────────────

INTERPRETATION_PROMPT = """你是财险经营诊断助手。只能依据给定诊断和证据输出。
返回严格JSON：summary字符串；facts数组（每项含text、evidenceId、currentValue）；
inferences数组（每项含text、confidence、evidenceIds）；investigations；
recommendations数组（每项含title、action、period、ownerRole、metric、evidenceIds）；
limitations数组。不得编造数字，不得把推断写成事实，不得把内部阈值称为行业标准。"""

STRICT_AGENT_PROMPT = """你是受控经营分析模型。你只能根据输入中的确定性工具结果和证据生成内容。
必须严格遵守 responseSchema。所有事实和数字必须引用 evidenceIds；不得自行计算、猜测或补充数字。
必须区分事实、推断和建议；不得把相关性写成确定因果。证据不足时返回空事实并在 limitations 中说明。
建议必须包含具体动作、指标、方向、责任角色、周期和证据，不得使用空泛表述。"""


# ── Shared Helpers ───────────────────────────────────────────────────────────

def diagnosis_response(row):
    result = db.load(row["payload"], {})
    result["id"] = row["id"]
    result["createdAt"] = row["created_at"]
    return result


def get_diagnosis(diagnosis_id, user):
    row = db.fetch_one("SELECT * FROM diagnoses WHERE id=?", (diagnosis_id,))
    if not row:
        raise HTTPException(404, "诊断不存在")
    assert_branch(user, row["branch"])
    return row


def get_evidence_for_diagnosis(diagnosis_id):
    return db.fetch_all("SELECT * FROM evidence WHERE diagnosis_id=? ORDER BY metric", (diagnosis_id,))


def ai_request(messages, json_mode=False):
    ai_enabled = runtime_value("AI_ENABLED", AI_ENABLED)
    ai_key = runtime_value("AI_KEY", AI_KEY)
    if not ai_enabled or not ai_key:
        raise HTTPException(503, "生成式AI当前未启用，基础诊断仍可使用")
    request_body = {
        "model": MODEL, "messages": messages, "temperature": 0.2,
        "max_tokens": 2500, "stream": False,
    }
    if json_mode:
        request_body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        AI_URL, data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {ai_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
            return result["choices"][0]["message"]["content"], result.get("usage", {})
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise HTTPException(429, "模型服务限流，请稍后重试") from exc
        raise HTTPException(502, f"模型服务调用失败：{exc.code}") from exc
    except TimeoutError as exc:
        raise HTTPException(504, "模型服务超时") from exc


def ai_error_type(exc):
    ai_enabled = runtime_value("AI_ENABLED", AI_ENABLED)
    ai_key = runtime_value("AI_KEY", AI_KEY)
    if not ai_enabled or not ai_key:
        return "closed"
    if isinstance(exc, json.JSONDecodeError):
        return "format_error"
    if isinstance(exc, HTTPException):
        return {
            429: "rate_limited", 502: "provider_error", 503: "closed",
            504: "timeout",
        }.get(exc.status_code, "safety_blocked" if exc.status_code == 403 else "provider_error")
    if isinstance(exc, ValueError):
        message = str(exc)
        return "numeric_error" if "数字" in message else "format_error"
    return "provider_error"


def rule_fallback(diagnosis):
    return {
        "summary": diagnosis.get("summary", "规则诊断可用"),
        "facts": diagnosis.get("facts", []),
        "inferences": diagnosis.get("inferences", []),
        "investigations": diagnosis.get("investigations", []),
        "recommendations": diagnosis.get("recommendations", []),
        "limitations": diagnosis.get("limitations", []),
        "degraded": True,
    }


def task_response(row):
    row["riskMetrics"] = db.load(row.pop("risk_metrics"), [])
    row["evidenceIds"] = db.load(row.pop("evidence_ids", "[]"), [])
    row["requiresEvidenceReview"] = bool(row.pop("requires_evidence_review", 0))
    mapping = {
        "diagnosis_id": "diagnosisId", "recommendation_index": "recommendationIndex",
        "owner_department": "ownerDepartment", "owner_name": "ownerName",
        "due_date": "dueDate", "current_value": "currentValue",
        "target_value": "targetValue", "created_by": "createdBy",
        "created_at": "createdAt", "updated_by": "updatedBy", "updated_at": "updatedAt",
        "metric_id": "metricId", "org_id": "orgId",
        "source_recommendation_id": "sourceRecommendationId",
        "binding_reason": "bindingReason",
    }
    for old, new in mapping.items():
        row[new] = row.pop(old)
    return row


def get_authorized_agent_run(run_id, user):
    result = agent_runtime.run_response(run_id)
    if not result:
        raise HTTPException(404, "智能体任务不存在")
    assert_org(user, result["orgId"], result["branch"])
    return result


def load_evaluation_cases(custom_cases=None):
    if custom_cases is not None:
        return custom_cases
    fixture = ROOT / "tests" / "fixtures" / "ai_regression_cases.json"
    agent_fixture = ROOT / "tests" / "fixtures" / "agent_regression_cases.json"
    if not fixture.exists():
        raise HTTPException(422, "未找到评测场景")
    cases = json.loads(fixture.read_text(encoding="utf-8"))
    if agent_fixture.exists():
        cases.extend(json.loads(agent_fixture.read_text(encoding="utf-8")))
    return merge_evaluation_cases(cases)


def normalized_evaluation_case(case):
    return {
        "id": case.get("id") or new_id("case"),
        "inputSnapshot": case.get("inputSnapshot") or {"scenario": case.get("scenario", "")},
        "allowedConclusions": case.get("allowedConclusions") or [case.get("expected", "")],
        "forbiddenConclusions": case.get("forbiddenConclusions") or [case.get("forbidden", "")],
        "requiredEvidence": case.get("requiredEvidence") or [],
        "expectedRecommendations": case.get("expectedRecommendations") or [],
    }
