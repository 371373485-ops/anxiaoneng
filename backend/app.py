import asyncio
import json
import os
import re
import time
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent_runtime, db
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
    score_evaluation_output,
    validate_interpretation_payload,
)


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


@asynccontextmanager
async def lifespan(_app):
    if os.getenv("APP_ENV", "development").lower() == "production":
        if AUTH_MODE not in {"proxy", "token"}:
            raise RuntimeError("生产环境 AUTH_MODE 必须为 proxy 或 token")
        if AUTH_MODE == "token" and not AUTH_TOKEN:
            raise RuntimeError("token 鉴权模式必须配置 API_AUTH_TOKEN")
    db.init_db()
    yield


app = FastAPI(
    title="智能经营诊断与整改闭环 API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.getenv(
        "ALLOWED_ORIGINS", "http://127.0.0.1:8921,http://localhost:8921"
    ).split(",") if item.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type", "Authorization", "X-User-Id", "X-Role", "X-Branches",
        "X-Authenticated-User", "X-Authenticated-Role", "X-Authenticated-Branches",
    ],
)

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
    if AUTH_MODE == "token" and authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(401, "身份认证失败")
    if AUTH_MODE == "proxy":
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


def diagnosis_response(row):
    result = db.load(row["payload"], {})
    result["id"] = row["id"]
    result["createdAt"] = row["created_at"]
    return result


@app.get("/api/health")
def health():
    return {
        "ok": True, "aiEnabled": AI_ENABLED and bool(AI_KEY),
        "model": MODEL if AI_ENABLED and AI_KEY else None,
        "database": "postgresql" if db.DATABASE_URL.startswith("postgres") else "sqlite",
        "authMode": AUTH_MODE,
    }


@app.get("/diagnosis-backend.json")
def backend_capability():
    return {"enabled": True}


@app.get("/api/organizations")
def list_organizations(
    org_type: str | None = Query(default=None, alias="type"),
    active: bool = True,
    user: Identity = Depends(identity),
):
    clauses, params = ["active=?"], [1 if active else 0]
    if org_type:
        clauses.append("org_type=?")
        params.append(org_type)
    rows = db.fetch_all(
        "SELECT * FROM organizations WHERE " + " AND ".join(clauses) + " ORDER BY name",
        tuple(params),
    )
    if user.role not in {"admin", "hq_management", "function"} and "*" not in user.branches:
        allowed = set(user.branches)
        rows = [
            row for row in rows
            if row["org_id"] in allowed or row["name"] in allowed
        ]
    return [
        {
            "orgId": row["org_id"], "orgCode": row["org_code"],
            "orgType": row["org_type"], "name": row["name"],
            "parentOrgId": row["parent_org_id"], "active": bool(row["active"]),
        }
        for row in rows
    ]


@app.post("/save-backup")
async def save_backup(request: Request, user: Identity = Depends(identity)):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(400, "备份必须为JSON对象") from exc
    if not isinstance(payload, dict) or not (
        isinstance(payload.get("actuals"), dict) or isinstance(payload.get("_plans"), dict)
    ):
        raise HTTPException(422, "备份缺少 actuals 或 _plans")
    serialized = db.dump(payload)
    if len(serialized.encode("utf-8")) > 10 * 1024 * 1024:
        raise HTTPException(413, "备份超过10MB")
    timestamp = now_iso()
    db.execute(
        """INSERT INTO data_backups (id,payload,created_by,created_at)
        VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,
        created_by=excluded.created_by,created_at=excluded.created_at""",
        ("default", serialized, user.user_id, timestamp),
    )
    return {"ok": True, "size": len(serialized.encode("utf-8"))}


@app.get("/_data_backup.json")
def read_backup(user: Identity = Depends(identity)):
    row = db.fetch_one("SELECT payload FROM data_backups WHERE id=?", ("default",))
    return db.load(row["payload"], {}) if row else {"actuals": {}, "_plans": {}}


@app.post("/api/diagnoses")
@db.atomic
def create_diagnosis(body: DiagnosisInput, user: Identity = Depends(identity)):
    assert_branch(user, body.branch)
    org_id = resolve_organization(body.branch, body.orgId)
    existing = db.fetch_one(
        "SELECT * FROM diagnoses WHERE org_id=? AND period=? AND data_version=? AND rule_version=?",
        (org_id, body.period, body.dataVersion, body.ruleVersion),
    )
    if existing:
        return diagnosis_response(existing)

    diagnosis_id = new_id("diag")
    created_at = now_iso()
    evidence_payload = []
    for item in body.evidence:
        evidence_id = item.id or new_id("ev")
        record = item.model_dump() if hasattr(item, "model_dump") else item.dict()
        record["id"] = evidence_id
        evidence_payload.append(record)
        if item.metricId and item.direction in METRIC_DIRECTIONS:
            db.execute(
                """INSERT INTO metric_metadata
                (metric_id,metric_key,label,unit,category,direction,benchmark_strategy,
                 trend_threshold,display_precision,calculation_version,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(metric_id) DO UPDATE SET
                metric_key=excluded.metric_key,label=excluded.label,unit=excluded.unit,
                direction=excluded.direction,benchmark_strategy=excluded.benchmark_strategy,
                calculation_version=excluded.calculation_version,updated_at=excluded.updated_at""",
                (
                    item.metricId, item.metric, item.label, item.unit, None, item.direction,
                    item.benchmarkType or "none", None, 1 if item.unit == "%" else 2,
                    item.calculationVersion or "calc-v1", created_at,
                ),
            )
        details = dict(item.details)
        details.update({
            "metricId": item.metricId, "direction": item.direction,
            "benchmarkType": item.benchmarkType, "benchmarkLabel": item.benchmarkLabel,
            "calculationVersion": item.calculationVersion, "rank": item.rank,
        })
        db.execute(
            """INSERT INTO evidence
            (id,diagnosis_id,org_id,branch,period,metric,label,metric_id,direction,
             benchmark_type,benchmark_label,calculation_version,current_value,
             benchmark_value,difference_value,unit,source,rule_id,payload,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                evidence_id, diagnosis_id, org_id, body.branch, body.period, item.metric,
                item.label, item.metricId, item.direction, item.benchmarkType,
                item.benchmarkLabel, item.calculationVersion,
                item.currentValue, item.benchmarkValue,
                item.differenceValue, item.unit, item.source, item.ruleId,
                db.dump(details), user.user_id, created_at,
            ),
        )
    payload = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    payload["id"] = diagnosis_id
    payload["orgId"] = org_id
    payload["evidence"] = evidence_payload
    db.execute(
        """INSERT INTO diagnoses
        (id,org_id,branch,period,schema_version,data_version,rule_version,
         created_by,created_at,risk_level,summary,payload)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            diagnosis_id, org_id, body.branch, body.period, body.schemaVersion,
            body.dataVersion, body.ruleVersion,
            user.user_id, created_at, body.riskLevel, body.summary, db.dump(payload),
        ),
    )
    audit(
        user, "diagnosis.create", "success", branch=body.branch, period=body.period,
        org_id=org_id,
        target_id=diagnosis_id, data_version=body.dataVersion, rule_version=body.ruleVersion,
    )
    return payload


def get_diagnosis(diagnosis_id, user):
    row = db.fetch_one("SELECT * FROM diagnoses WHERE id=?", (diagnosis_id,))
    if not row:
        raise HTTPException(404, "诊断不存在")
    assert_branch(user, row["branch"])
    return row


def get_evidence_for_diagnosis(diagnosis_id):
    return db.fetch_all("SELECT * FROM evidence WHERE diagnosis_id=? ORDER BY metric", (diagnosis_id,))


def ai_request(messages, json_mode=False):
    if not AI_ENABLED or not AI_KEY:
        raise HTTPException(503, "生成式AI当前未启用，基础诊断仍可使用")
    request_body = {
        "model": MODEL, "messages": messages, "temperature": 0.2,
        "max_tokens": 2500, "stream": False,
    }
    if json_mode:
        request_body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        AI_URL, data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {AI_KEY}"},
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
    if not AI_ENABLED or not AI_KEY:
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


INTERPRETATION_PROMPT = """你是财险经营诊断助手。只能依据给定诊断和证据输出。
返回严格JSON：summary字符串；facts数组（每项含text、evidenceId、currentValue）；
inferences数组（每项含text、confidence、evidenceIds）；investigations数组；
recommendations数组（每项含title、action、period、ownerRole、metric、evidenceIds）；
limitations数组。不得编造数字，不得把推断写成事实，不得把内部阈值称为行业标准。"""


@app.post("/api/diagnoses/{diagnosis_id}/interpretations")
def create_interpretation(diagnosis_id: str, user: Identity = Depends(identity)):
    started = time.monotonic()
    diagnosis = get_diagnosis(diagnosis_id, user)
    evidence = get_evidence_for_diagnosis(diagnosis_id)
    context = {
        "diagnosis": db.load(diagnosis["payload"], {}),
        "evidence": [
            {
                "id": item["id"], "metric": item["metric"], "label": item["label"],
                "currentValue": item["current_value"], "benchmarkValue": item["benchmark_value"],
                "differenceValue": item["difference_value"], "unit": item["unit"],
                "source": item["source"], "ruleId": item["rule_id"],
            }
            for item in evidence
        ],
    }
    try:
        for attempt in range(2):
            try:
                content, usage = ai_request([
                    {"role": "system", "content": INTERPRETATION_PROMPT},
                    {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                ], json_mode=True)
                payload = validate_interpretation(json.loads(content), evidence)
                break
            except Exception:
                if attempt == 1:
                    raise
        interpretation_id = new_id("int")
        created_at = now_iso()
        db.execute(
            """INSERT INTO interpretations
            (id,diagnosis_id,org_id,branch,period,model,prompt_version,schema_version,
             payload,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                interpretation_id, diagnosis_id, diagnosis["org_id"],
                diagnosis["branch"], diagnosis["period"],
                MODEL, PROMPT_VERSION, SCHEMA_VERSION, db.dump(payload),
                user.user_id, created_at,
            ),
        )
        payload.update({"id": interpretation_id, "diagnosisId": diagnosis_id})
        audit(
            user, "interpretation.create", "success", branch=diagnosis["branch"],
            period=diagnosis["period"], target_id=interpretation_id, model=MODEL,
            prompt_version=PROMPT_VERSION, schema_version=SCHEMA_VERSION,
            data_version=diagnosis["data_version"], rule_version=diagnosis["rule_version"],
            latency_ms=int((time.monotonic() - started) * 1000),
            token_usage=usage.get("total_tokens"),
        )
        return payload
    except Exception as exc:
        error_type = ai_error_type(exc)
        audit(
            user, "interpretation.create", "degraded", branch=diagnosis["branch"],
            org_id=diagnosis["org_id"],
            period=diagnosis["period"], target_id=diagnosis_id, model=MODEL,
            prompt_version=PROMPT_VERSION, schema_version=SCHEMA_VERSION,
            data_version=diagnosis["data_version"], rule_version=diagnosis["rule_version"],
            latency_ms=int((time.monotonic() - started) * 1000),
            error_type=error_type, details={"message": str(exc), "retried": True},
        )
        payload = rule_fallback(context["diagnosis"])
        interpretation_id = new_id("int")
        created_at = now_iso()
        payload.update({
            "id": interpretation_id, "diagnosisId": diagnosis_id,
            "degradeReason": error_type,
        })
        db.execute(
            """INSERT INTO interpretations
            (id,diagnosis_id,org_id,branch,period,model,prompt_version,schema_version,
             payload,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                interpretation_id, diagnosis_id, diagnosis["org_id"],
                diagnosis["branch"], diagnosis["period"], "rule-fallback",
                PROMPT_VERSION, SCHEMA_VERSION, db.dump(payload), user.user_id, created_at,
            ),
        )
        return payload


@app.get("/api/evidence/{evidence_id}")
def get_evidence(evidence_id: str, user: Identity = Depends(identity)):
    row = db.fetch_one("SELECT * FROM evidence WHERE id=?", (evidence_id,))
    if not row:
        raise HTTPException(404, "证据不存在")
    assert_branch(user, row["branch"])
    row["details"] = db.load(row.pop("payload"), {})
    return row


class MessageInput(BaseModel):
    diagnosisId: str
    question: str = Field(min_length=1, max_length=2000)


@app.post("/api/conversations/{conversation_id}/messages")
async def post_message(
    conversation_id: str, body: MessageInput, request: Request,
    user: Identity = Depends(identity),
):
    diagnosis = get_diagnosis(body.diagnosisId, user)
    if contains_prompt_injection(body.question):
        raise HTTPException(422, "问题包含疑似提示注入或越权指令，已阻止发送")
    history = db.fetch_all(
        "SELECT role,content FROM messages WHERE conversation_id=? AND diagnosis_id=? ORDER BY created_at",
        (conversation_id, body.diagnosisId),
    )[-10:]
    evidence = get_evidence_for_diagnosis(body.diagnosisId)
    context = {
        "diagnosis": db.load(diagnosis["payload"], {}),
        "evidence": [{"id": e["id"], "label": e["label"], "currentValue": e["current_value"], "unit": e["unit"]} for e in evidence],
    }
    user_message_id = new_id("msg")
    db.execute(
        """INSERT INTO messages
        (id,conversation_id,diagnosis_id,org_id,branch,period,role,content,evidence_ids,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            user_message_id, conversation_id, body.diagnosisId, diagnosis["org_id"], diagnosis["branch"],
            diagnosis["period"], "user", body.question, "[]", user.user_id, now_iso(),
        ),
    )

    async def stream():
        try:
            content, usage = await asyncio.to_thread(ai_request, [
                {"role": "system", "content": INTERPRETATION_PROMPT + "\n回答追问时简洁、标注证据ID。"},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                *history,
                {"role": "user", "content": body.question},
            ], True)
            structured = validate_interpretation_payload(json.loads(content), evidence)
            content = json.dumps(structured, ensure_ascii=False)
            answer_id = new_id("msg")
            db.execute(
                """INSERT INTO messages
                (id,conversation_id,diagnosis_id,org_id,branch,period,role,content,evidence_ids,created_by,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    answer_id, conversation_id, body.diagnosisId, diagnosis["org_id"], diagnosis["branch"],
                    diagnosis["period"], "assistant", content, "[]", user.user_id, now_iso(),
                ),
            )
            for offset in range(0, len(content), 48):
                if await request.is_disconnected():
                    audit(user, "conversation.message", "cancelled", branch=diagnosis["branch"], period=diagnosis["period"], target_id=answer_id)
                    return
                yield "data: " + json.dumps({"content": content[offset:offset + 48]}, ensure_ascii=False) + "\n\n"
                await asyncio.sleep(0)
            yield "data: " + json.dumps({
                "done": True, "messageId": answer_id, "usage": usage,
                "structured": structured,
            }, ensure_ascii=False) + "\n\n"
            audit(user, "conversation.message", "success", branch=diagnosis["branch"], period=diagnosis["period"], target_id=answer_id, model=MODEL)
        except HTTPException as exc:
            yield "data: " + json.dumps({"error": exc.detail}, ensure_ascii=False) + "\n\n"
        except (ValueError, json.JSONDecodeError) as exc:
            fallback = rule_fallback(context["diagnosis"])
            yield "data: " + json.dumps({
                "done": True, "degraded": True,
                "degradeReason": ai_error_type(exc), "structured": fallback,
            }, ensure_ascii=False) + "\n\n"
            audit(
                user, "conversation.message", "degraded",
                org_id=diagnosis["org_id"], branch=diagnosis["branch"],
                period=diagnosis["period"], target_id=user_message_id,
                error_type=ai_error_type(exc),
            )
        except asyncio.CancelledError:
            audit(user, "conversation.message", "cancelled", branch=diagnosis["branch"], period=diagnosis["period"], target_id=user_message_id)
            raise

    return StreamingResponse(stream(), media_type="text/event-stream")


class FeedbackInput(BaseModel):
    targetId: str
    targetType: str
    branch: str
    period: str
    feedbackType: str
    comment: str | None = None


class EvaluationRunInput(BaseModel):
    cases: list[dict] | None = None


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
    return cases


def normalized_evaluation_case(case):
    return {
        "id": case.get("id") or new_id("case"),
        "inputSnapshot": case.get("inputSnapshot") or {"scenario": case.get("scenario", "")},
        "allowedConclusions": case.get("allowedConclusions") or [case.get("expected", "")],
        "forbiddenConclusions": case.get("forbiddenConclusions") or [case.get("forbidden", "")],
        "requiredEvidence": case.get("requiredEvidence") or [],
        "expectedRecommendations": case.get("expectedRecommendations") or [],
    }


@app.post("/api/evaluations/run")
@db.atomic
def run_evaluation(body: EvaluationRunInput, user: Identity = Depends(identity)):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可运行评测")
    cases = [normalized_evaluation_case(item) for item in load_evaluation_cases(body.cases)]
    if not cases:
        raise HTTPException(422, "评测场景不能为空")
    run_id = new_id("eval")
    created_at = now_iso()
    counters = {
        "schemaSuccess": 0, "numericSuccess": 0, "unsupportedConclusion": 0,
        "evidenceSuccess": 0, "recommendationSuccess": 0,
        "criticalViolation": 0, "fallbackAttempts": 0, "fallbackSuccess": 0,
    }
    for case in cases:
        status = "passed"
        error_type = None
        fallback_success = False
        output = None
        try:
            if not AI_ENABLED or not AI_KEY:
                raise HTTPException(503, "AI closed")
            content, _usage = ai_request([
                {"role": "system", "content": INTERPRETATION_PROMPT},
                {"role": "user", "content": json.dumps(case["inputSnapshot"], ensure_ascii=False)},
            ], json_mode=True)
            output = json.loads(content)
            score = score_evaluation_output(output, case)
            counters["schemaSuccess"] += int(score.schema_success)
            counters["numericSuccess"] += int(score.numeric_success)
            counters["evidenceSuccess"] += int(score.evidence_success)
            counters["recommendationSuccess"] += int(score.recommendation_success)
            counters["unsupportedConclusion"] += score.unsupported_conclusions
            counters["criticalViolation"] += len(score.critical_violations)
            if score.critical_violations:
                error_type = ",".join(score.critical_violations)
                status = "failed"
        except Exception as exc:
            error_type = ai_error_type(exc)
            counters["fallbackAttempts"] += 1
            output = {"degraded": True, "summary": "规则诊断可用"}
            fallback_success = True
            counters["fallbackSuccess"] += 1
            status = "degraded"
        db.execute(
            """INSERT INTO evaluation_cases
            (id,run_id,case_id,input_snapshot,allowed_conclusions,forbidden_conclusions,
             required_evidence,expected_recommendations,status,output,error_type,
             fallback_success,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                new_id("evalcase"), run_id, case["id"], db.dump(case["inputSnapshot"]),
                db.dump(case["allowedConclusions"]), db.dump(case["forbiddenConclusions"]),
                db.dump(case["requiredEvidence"]), db.dump(case["expectedRecommendations"]),
                status, db.dump(output), error_type, int(fallback_success), created_at,
            ),
        )
    total = len(cases)
    metrics = {
        "numericAccuracy": counters["numericSuccess"] / total,
        "evidenceValidityRate": counters["evidenceSuccess"] / total,
        "recommendationCompletenessRate": counters["recommendationSuccess"] / total,
        "unsupportedConclusionRate": counters["unsupportedConclusion"] / total,
        "schemaSuccessRate": counters["schemaSuccess"] / total,
        "criticalViolations": counters["criticalViolation"],
        "fallbackSuccessRate": (
            counters["fallbackSuccess"] / counters["fallbackAttempts"]
            if counters["fallbackAttempts"] else 1.0
        ),
    }
    gate_passed = (
        metrics["numericAccuracy"] >= 0.99
        and metrics["evidenceValidityRate"] == 1.0
        and metrics["recommendationCompletenessRate"] >= 0.95
        and metrics["unsupportedConclusionRate"] <= 0.02
        and metrics["schemaSuccessRate"] >= 0.98
        and metrics["criticalViolations"] == 0
        and metrics["fallbackSuccessRate"] == 1.0
    )
    completed_at = now_iso()
    db.execute(
        """INSERT INTO evaluation_runs
        (id,status,model,temperature,prompt_version,schema_version,total_cases,
         completed_cases,metrics,gate_passed,created_by,created_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            run_id, "completed", MODEL, EVALUATION_TEMPERATURE, PROMPT_VERSION,
            EVALUATION_SCHEMA_VERSION, total, total, db.dump(metrics), int(gate_passed),
            user.user_id, created_at, completed_at,
        ),
    )
    audit(
        user, "evaluation.run", "success", target_id=run_id, model=MODEL,
        prompt_version=PROMPT_VERSION, schema_version=EVALUATION_SCHEMA_VERSION,
        details={"gatePassed": gate_passed, "metrics": metrics},
    )
    return {
        "id": run_id, "status": "completed", "model": MODEL,
        "temperature": EVALUATION_TEMPERATURE, "promptVersion": PROMPT_VERSION,
        "schemaVersion": EVALUATION_SCHEMA_VERSION, "totalCases": total,
        "completedCases": total, "metrics": metrics, "gatePassed": gate_passed,
    }


@app.get("/api/evaluations/{run_id}")
def get_evaluation(run_id: str, user: Identity = Depends(identity)):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可查看评测")
    run = db.fetch_one("SELECT * FROM evaluation_runs WHERE id=?", (run_id,))
    if not run:
        raise HTTPException(404, "评测运行不存在")
    cases = db.fetch_all(
        "SELECT * FROM evaluation_cases WHERE run_id=? ORDER BY case_id", (run_id,)
    )
    return {
        "id": run["id"], "status": run["status"], "model": run["model"],
        "temperature": run["temperature"], "promptVersion": run["prompt_version"],
        "schemaVersion": run["schema_version"], "totalCases": run["total_cases"],
        "completedCases": run["completed_cases"], "metrics": db.load(run["metrics"], {}),
        "gatePassed": bool(run["gate_passed"]),
        "cases": [
            {
                "caseId": item["case_id"], "status": item["status"],
                "errorType": item["error_type"],
                "fallbackSuccess": bool(item["fallback_success"]),
                "output": db.load(item["output"], {}),
            }
            for item in cases
        ],
    }


@app.post("/api/feedback")
def create_feedback(body: FeedbackInput, user: Identity = Depends(identity)):
    assert_branch(user, body.branch)
    org_id = resolve_organization(body.branch)
    if body.feedbackType not in FEEDBACK_TYPES:
        raise HTTPException(422, "无效反馈类型")
    feedback_id = new_id("fb")
    db.execute(
        """INSERT INTO feedback
        (id,target_id,target_type,org_id,branch,period,feedback_type,comment,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            feedback_id, body.targetId, body.targetType, org_id, body.branch, body.period,
            body.feedbackType, body.comment, user.user_id, now_iso(),
        ),
    )
    audit(user, "feedback.create", "success", branch=body.branch, period=body.period, target_id=feedback_id)
    return {"id": feedback_id, "ok": True}


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
    sourceRecommendationId: str | None = None


def task_response(row):
    row["riskMetrics"] = db.load(row.pop("risk_metrics"), [])
    mapping = {
        "diagnosis_id": "diagnosisId", "recommendation_index": "recommendationIndex",
        "owner_department": "ownerDepartment", "owner_name": "ownerName",
        "due_date": "dueDate", "current_value": "currentValue",
        "target_value": "targetValue", "created_by": "createdBy",
        "created_at": "createdAt", "updated_by": "updatedBy", "updated_at": "updatedAt",
        "metric_id": "metricId", "org_id": "orgId",
        "source_recommendation_id": "sourceRecommendationId",
    }
    for old, new in mapping.items():
        row[new] = row.pop(old)
    return row


@app.post("/api/remediation-tasks")
@db.atomic
def create_task(body: TaskInput, user: Identity = Depends(identity)):
    diagnosis = get_diagnosis(body.diagnosisId, user)
    diagnosis_payload = db.load(diagnosis["payload"], {})
    recommendation = next(
        (
            item for item in diagnosis_payload.get("recommendations", [])
            if body.sourceRecommendationId and item.get("id") == body.sourceRecommendationId
        ),
        None,
    )
    metric_id = body.metricId or (recommendation or {}).get("metricId")
    metric_key = body.metric or (recommendation or {}).get("metric")
    if metric_id:
        metadata = db.fetch_one(
            "SELECT * FROM metric_metadata WHERE metric_id=?", (metric_id,)
        )
    elif metric_key:
        metadata = db.fetch_one(
            "SELECT * FROM metric_metadata WHERE metric_key=?", (metric_key,)
        )
    else:
        metadata = None
    if not metadata:
        raise HTTPException(422, "整改任务指标缺少有效元数据，无法确定改善方向")
    metric_id = metadata["metric_id"]
    direction = metadata["direction"]
    task_id = new_id("task")
    timestamp = now_iso()
    db.execute(
        """INSERT INTO remediation_tasks
        (id,diagnosis_id,recommendation_index,source_recommendation_id,org_id,metric_id,
         branch,period,title,risk_metrics,
         description,action,owner_department,owner_name,due_date,current_value,
         target_value,metric,direction,status,created_by,created_at,updated_by,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            task_id, body.diagnosisId, body.recommendationIndex, body.sourceRecommendationId,
            diagnosis_payload.get("orgId"), metric_id, diagnosis["branch"],
            diagnosis["period"], body.title, db.dump(body.riskMetrics), body.description,
            body.action, body.ownerDepartment, body.ownerName, body.dueDate,
            body.currentValue, body.targetValue, body.metric or metadata["metric_key"], direction,
            "draft", user.user_id, timestamp, user.user_id, timestamp,
        ),
    )
    db.execute(
        """INSERT INTO task_status_history
        (id,task_id,from_status,to_status,changed_by,changed_at,details)
        VALUES (?,?,?,?,?,?,?)""",
        (new_id("taskhist"), task_id, None, "draft", user.user_id, timestamp, "{}"),
    )
    audit(user, "remediation.create", "success", branch=diagnosis["branch"], period=diagnosis["period"], target_id=task_id)
    return task_response(db.fetch_one("SELECT * FROM remediation_tasks WHERE id=?", (task_id,)))


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


@app.patch("/api/remediation-tasks/{task_id}")
@db.atomic
def update_task(task_id: str, body: TaskPatch, user: Identity = Depends(identity)):
    row = db.fetch_one("SELECT * FROM remediation_tasks WHERE id=?", (task_id,))
    if not row:
        raise HTTPException(404, "任务不存在")
    assert_branch(user, row["branch"])
    if row["status"] == "closed":
        raise HTTPException(409, "已关闭任务不可修改")
    incoming = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    mapping = {
        "riskMetrics": "risk_metrics", "ownerDepartment": "owner_department",
        "ownerName": "owner_name", "dueDate": "due_date",
        "currentValue": "current_value", "targetValue": "target_value",
    }
    for key, value in list(incoming.items()):
        incoming[mapping.get(key, key)] = db.dump(value) if key == "riskMetrics" else value
        if mapping.get(key, key) != key:
            del incoming[key]
    requested_status = incoming.pop("status", None)
    merged = {**row, **incoming}
    status = row["status"]
    if requested_status:
        try:
            status = next_task_state(row["status"], requested_status)
            validate_task_fields(merged, status)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
    incoming.update({"status": status, "updated_by": user.user_id, "updated_at": now_iso()})
    assignments = ",".join(f"{column}=?" for column in incoming)
    db.execute(
        f"UPDATE remediation_tasks SET {assignments} WHERE id=?",
        (*incoming.values(), task_id),
    )
    if requested_status and status != row["status"]:
        db.execute(
            """INSERT INTO task_status_history
            (id,task_id,from_status,to_status,changed_by,changed_at,details)
            VALUES (?,?,?,?,?,?,?)""",
            (
                new_id("taskhist"), task_id, row["status"], status, user.user_id,
                incoming["updated_at"], db.dump({"source": "api"}),
            ),
        )
    audit(user, "remediation.update", "success", branch=row["branch"], period=row["period"], target_id=task_id, details={"status": status})
    return task_response(db.fetch_one("SELECT * FROM remediation_tasks WHERE id=?", (task_id,)))


@app.get("/api/remediation-tasks")
def list_tasks(
    branch: str | None = Query(default=None), status: str | None = Query(default=None),
    user: Identity = Depends(identity),
):
    clauses, params = [], []
    if branch:
        assert_branch(user, branch)
        clauses.append("branch=?")
        params.append(branch)
    if status:
        clauses.append("status=?")
        params.append(status)
    if user.role not in {"admin", "hq_management", "function"} and "*" not in user.branches:
        placeholders = ",".join("?" for _ in user.branches)
        clauses.append(f"branch IN ({placeholders})")
        params.extend(user.branches)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    return [task_response(row) for row in db.fetch_all(
        "SELECT * FROM remediation_tasks" + where + " ORDER BY updated_at DESC", tuple(params)
    )]


class ReviewInput(BaseModel):
    diagnosisId: str


@app.post("/api/remediation-tasks/{task_id}/reviews")
@db.atomic
def create_review(task_id: str, body: ReviewInput, user: Identity = Depends(identity)):
    task = db.fetch_one("SELECT * FROM remediation_tasks WHERE id=?", (task_id,))
    if not task:
        raise HTTPException(404, "任务不存在")
    assert_branch(user, task["branch"])
    diagnosis = get_diagnosis(body.diagnosisId, user)
    if diagnosis["branch"] != task["branch"] or diagnosis["period"] <= task["period"]:
        raise HTTPException(422, "必须选择同机构的后续数据周期")
    evidence = db.fetch_one(
        "SELECT * FROM evidence WHERE diagnosis_id=? AND metric=?",
        (body.diagnosisId, task["metric"]),
    ) if task["metric"] else None
    current = evidence["current_value"] if evidence else None
    result = classify_review(task["current_value"], current, task["direction"], task["target_value"])
    previous_evidence = db.fetch_one(
        "SELECT * FROM evidence WHERE diagnosis_id=? AND metric=?",
        (task["diagnosis_id"], task["metric"]),
    ) if task["metric"] else None
    previous_details = db.load(previous_evidence["payload"], {}) if previous_evidence else {}
    current_details = db.load(evidence["payload"], {}) if evidence else {}
    benchmark_change = None
    if (
        previous_evidence and evidence
        and previous_evidence["benchmark_value"] is not None
        and evidence["benchmark_value"] is not None
    ):
        benchmark_change = evidence["benchmark_value"] - previous_evidence["benchmark_value"]
    rank_change = None
    if previous_details.get("rank") is not None and current_details.get("rank") is not None:
        rank_change = previous_details["rank"] - current_details["rank"]
    review_id = new_id("review")
    limitations = "复盘结果反映指标变化及相关性，不代表整改措施与结果之间存在确定因果关系。"
    db.execute(
        """INSERT INTO remediation_reviews
        (id,task_id,diagnosis_id,org_id,branch,period,previous_value,current_value,change_value,
         change_ratio,result,target_met,previous_target_distance,current_target_distance,
         target_distance_change,benchmark_change,rank_change,limitations,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            review_id, task_id, body.diagnosisId, task["org_id"], task["branch"], diagnosis["period"],
            task["current_value"], current, result["change"], result["changeRatio"], result["result"],
            None if result["targetMet"] is None else int(result["targetMet"]),
            result["previousTargetDistance"], result["currentTargetDistance"],
            result["targetDistanceChange"], benchmark_change, rank_change,
            limitations, user.user_id, now_iso(),
        ),
    )
    audit(user, "remediation.review", "success", branch=task["branch"], period=diagnosis["period"], target_id=review_id)
    return {
        "id": review_id, "taskId": task_id, "period": diagnosis["period"],
        "previousValue": task["current_value"], "currentValue": current,
        "changeValue": result["change"], "changeRatio": result["changeRatio"],
        "result": result["result"], "targetMet": result["targetMet"],
        "previousTargetDistance": result["previousTargetDistance"],
        "currentTargetDistance": result["currentTargetDistance"],
        "targetDistanceChange": result["targetDistanceChange"],
        "benchmarkChange": benchmark_change, "rankChange": rank_change,
        "limitations": limitations,
    }


@app.get("/api/audit-logs")
def list_audit_logs(
    branch: str | None = None, period: str | None = None,
    status: str | None = None, limit: int = Query(default=100, ge=1, le=500),
    user: Identity = Depends(identity),
):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可查看审计日志")
    clauses, params = [], []
    for column, value in (("branch", branch), ("period", period), ("status", status)):
        if value:
            clauses.append(f"{column}=?")
            params.append(value)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.fetch_all(
        "SELECT * FROM audit_logs" + where + " ORDER BY created_at DESC LIMIT ?",
        (*params, limit),
    )
    for row in rows:
        row["details"] = db.load(row["details"], {})
    audit(
        user, "audit.query", "success",
        branch=branch, period=period,
        details={"filters": {"branch": branch, "period": period, "status": status, "limit": limit}},
    )
    return rows


class AgentRunInput(BaseModel):
    goal: str = Field(min_length=1, max_length=2000)
    orgId: str | None = None
    branch: str | None = None
    period: str | None = None
    metricIds: list[str] = Field(default_factory=list)
    taskType: str = "analysis"
    outputFormat: str = "structured"
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


@app.get("/api/tools")
def list_agent_tools(user: Identity = Depends(identity)):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权查看工具注册信息")
    return {
        "version": agent_runtime.TOOL_VERSION,
        "tools": agent_runtime.tool_catalog(),
    }


@app.post("/api/agent-runs")
def create_agent_run(body: AgentRunInput, user: Identity = Depends(identity)):
    payload = body.model_dump()
    branch = payload.get("branch")
    org_id = payload.get("orgId")
    if branch and not org_id:
        assert_branch(user, branch)
        org_id = resolve_organization(branch)
        payload["orgId"] = org_id
    elif org_id and not branch:
        organization = db.fetch_one(
            "SELECT * FROM organizations WHERE org_id=?", (org_id,)
        )
        if organization:
            branch = organization["name"]
            payload["branch"] = branch
    if org_id:
        assert_org(user, org_id, branch)
    try:
        result = agent_runtime.create_run(payload, user.user_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit(
        user, "agent.run.create", "success", org_id=result["orgId"],
        branch=result["branch"], period=result["period"], target_id=result["id"],
        prompt_version=agent_runtime.AGENT_PROMPT_VERSION,
        schema_version=agent_runtime.AGENT_SCHEMA_VERSION,
        details={"status": result["status"], "toolVersion": agent_runtime.TOOL_VERSION},
    )
    return result


def get_authorized_agent_run(run_id, user):
    result = agent_runtime.run_response(run_id)
    if not result:
        raise HTTPException(404, "智能体任务不存在")
    assert_org(user, result["orgId"], result["branch"])
    return result


@app.get("/api/agent-runs/{run_id}")
def get_agent_run(run_id: str, user: Identity = Depends(identity)):
    return get_authorized_agent_run(run_id, user)


@app.post("/api/agent-runs/{run_id}/inputs")
def add_agent_inputs(
    run_id: str, body: AgentInputs, user: Identity = Depends(identity),
):
    current = get_authorized_agent_run(run_id, user)
    payload = body.model_dump(exclude_none=True)
    next_org_id = payload.get("orgId", current["orgId"])
    next_branch = payload.get("branch", current["branch"])
    if next_branch and not next_org_id:
        next_org_id = resolve_organization(next_branch)
        payload["orgId"] = next_org_id
    assert_org(user, next_org_id, next_branch)
    try:
        result = agent_runtime.add_inputs(run_id, payload, user.user_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    audit(
        user, "agent.run.resume", "success", org_id=result["orgId"],
        branch=result["branch"], period=result["period"], target_id=run_id,
        details={"status": result["status"]},
    )
    return result


@app.post("/api/agent-runs/{run_id}/cancel")
def cancel_agent_run(run_id: str, user: Identity = Depends(identity)):
    current = get_authorized_agent_run(run_id, user)
    if current["status"] == "completed":
        raise HTTPException(409, "已完成任务不能取消")
    result = agent_runtime.cancel_run(run_id)
    audit(
        user, "agent.run.cancel", "success", org_id=result["orgId"],
        branch=result["branch"], period=result["period"], target_id=run_id,
    )
    return result


@app.get("/api/agent-memories")
def get_agent_memories(
    org_id: str = Query(alias="orgId"),
    memory_type: str | None = Query(default=None, alias="type"),
    user: Identity = Depends(identity),
):
    organization = db.fetch_one(
        "SELECT * FROM organizations WHERE org_id=?", (org_id,)
    )
    assert_org(user, org_id, organization["name"] if organization else None)
    return agent_runtime.list_memories(org_id, user.user_id, memory_type)


@app.post("/api/agent-memories")
def put_agent_memory(body: AgentMemoryInput, user: Identity = Depends(identity)):
    organization = db.fetch_one(
        "SELECT * FROM organizations WHERE org_id=?", (body.orgId,)
    )
    assert_org(user, body.orgId, organization["name"] if organization else None)
    try:
        result = agent_runtime.save_memory(
            body.orgId, user.user_id, body.type, body.key,
            body.payload, body.sourceId,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit(
        user, "agent.memory.upsert", "success", org_id=body.orgId,
        target_id=body.key, details={"type": body.type},
    )
    return result


@app.get("/api/pilot-metrics")
def pilot_metrics(user: Identity = Depends(identity)):
    if user.role not in {"admin", "hq_management"}:
        raise HTTPException(403, "当前角色无权查看试点指标")
    run_rows = db.fetch_all(
        "SELECT status,COUNT(*) AS total FROM agent_runs GROUP BY status"
    )
    statuses = {row["status"]: row["total"] for row in run_rows}
    total_runs = sum(statuses.values())
    tool_stats = db.fetch_one(
        """SELECT COUNT(*) AS total,AVG(latency_ms) AS avg_latency
           FROM tool_executions"""
    ) or {"total": 0, "avg_latency": 0}
    feedback_rows = db.fetch_all(
        "SELECT feedback_type,COUNT(*) AS total FROM feedback GROUP BY feedback_type"
    )
    feedback = {row["feedback_type"]: row["total"] for row in feedback_rows}
    feedback_total = sum(feedback.values())
    tasks = db.fetch_one("SELECT COUNT(*) AS total FROM remediation_tasks")
    token_usage = db.fetch_one(
        "SELECT COALESCE(SUM(token_usage),0) AS total FROM audit_logs"
    )
    latest_eval = db.fetch_one(
        "SELECT * FROM evaluation_runs ORDER BY created_at DESC"
    )
    return {
        "runs": {"total": total_runs, "byStatus": statuses},
        "failureRate": (
            (statuses.get("failed", 0) / total_runs) if total_runs else 0
        ),
        "degradationRate": (
            (statuses.get("degraded", 0) / total_runs) if total_runs else 0
        ),
        "helpfulRate": (
            (feedback.get("helpful", 0) / feedback_total) if feedback_total else None
        ),
        "taskConversions": tasks["total"] if tasks else 0,
        "toolExecutions": tool_stats["total"] or 0,
        "averageToolLatencyMs": round(tool_stats["avg_latency"] or 0, 2),
        "tokenUsage": token_usage["total"] if token_usage else 0,
        "latestEvaluation": (
            {
                "id": latest_eval["id"],
                "gatePassed": bool(latest_eval["gate_passed"]),
                "metrics": db.load(latest_eval["metrics"], {}),
            }
            if latest_eval else None
        ),
    }


if os.getenv("SERVE_FRONTEND", "true").lower() == "true":
    app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
