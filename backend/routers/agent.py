"""Agent run, shadow, human review, release gate, and pilot metrics routes."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query

from ..shared import (
    AI_ENABLED,
    AI_KEY,
    MODEL,
    STRICT_AGENT_PROMPT,
    AgentInputs,
    AgentMemoryInput,
    AgentRunInput,
    HumanReviewInput,
    ReleaseGateInput,
    ShadowRunInput,
    Identity,
    assert_org,
    audit,
    get_authorized_agent_run,
    identity,
    ai_request,
    ai_error_type,
    db,
)
from .. import agent_runtime, governance, model_provider
from ..domain import new_id

router = APIRouter()


@router.post("/api/agent-runs")
def create_agent_run(body: AgentRunInput, user: Identity = Depends(identity)):
    payload = body.model_dump()
    branch = payload.get("branch")
    org_id = payload.get("orgId")
    if branch and not org_id:
        from ..shared import assert_branch, resolve_organization
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


@router.get("/api/agent-runs/{run_id}")
def get_agent_run(run_id: str, user: Identity = Depends(identity)):
    return get_authorized_agent_run(run_id, user)


@router.post("/api/agent-runs/{run_id}/inputs")
def add_agent_inputs(
    run_id: str, body: AgentInputs, user: Identity = Depends(identity),
):
    current = get_authorized_agent_run(run_id, user)
    payload = body.model_dump(exclude_none=True)
    next_org_id = payload.get("orgId", current["orgId"])
    next_branch = payload.get("branch", current["branch"])
    if next_branch and not next_org_id:
        from ..shared import resolve_organization
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


@router.post("/api/agent-runs/{run_id}/cancel")
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


@router.get("/api/agent-memories")
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


@router.post("/api/agent-memories")
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


@router.post("/api/shadow-runs")
def create_shadow_run(body: ShadowRunInput, user: Identity = Depends(identity)):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权创建影子运行")
    assert_org(user, body.orgId, body.branch)
    result = governance.create_shadow_run(
        agent_run_id=body.agentRunId,
        org_id=body.orgId,
        branch=body.branch,
        period=body.period,
        goal=body.goal,
        candidate_output=body.candidateOutput,
        model=body.model,
        validation_policy=body.validationPolicy,
        risk_level=body.riskLevel,
        user_id=user.user_id,
    )
    audit(
        user, "shadow.run.create", result["status"],
        org_id=body.orgId, branch=body.branch, period=body.period,
        target_id=result["id"], model=body.model,
        details={"visibleToUser": False, "blockers": result["validationReport"]["blockers"]},
    )
    return result


@router.post("/api/agent-runs/{run_id}/shadow-generate")
def generate_agent_shadow(run_id: str, user: Identity = Depends(identity)):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权运行模型影子分析")
    if not AI_ENABLED or not AI_KEY:
        raise HTTPException(503, "AI保持关闭；配置并显式启用后才能运行影子分析")
    run = get_authorized_agent_run(run_id, user)
    evidence = db.fetch_all(
        "SELECT * FROM evidence WHERE org_id=? AND period=? ORDER BY metric",
        (run["orgId"], run["period"]),
    )
    request_context = model_provider.build_grounded_model_request(
        run["goal"], run["plan"], run["steps"], evidence,
    )
    last_error = None
    for attempt in range(2):
        try:
            content, _usage = ai_request([
                {"role": "system", "content": STRICT_AGENT_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(request_context, ensure_ascii=False),
                },
            ], json_mode=True)
            candidate = model_provider.parse_strict_output(content)
            result = governance.create_shadow_run(
                agent_run_id=run_id, org_id=run["orgId"],
                branch=run["branch"], period=run["period"], goal=run["goal"],
                candidate_output=candidate, model=MODEL,
                validation_policy=run["validationPolicy"],
                risk_level=run["riskLevel"], user_id=user.user_id,
            )
            audit(
                user, "shadow.run.generate", result["status"],
                org_id=run["orgId"], branch=run["branch"], period=run["period"],
                target_id=result["id"], model=MODEL,
                prompt_version=agent_runtime.AGENT_PROMPT_VERSION,
                schema_version=agent_runtime.AGENT_SCHEMA_VERSION,
                details={"attempt": attempt + 1, "visibleToUser": False},
            )
            return result
        except Exception as exc:
            last_error = exc
    audit(
        user, "shadow.run.generate", "degraded",
        org_id=run["orgId"], branch=run["branch"], period=run["period"],
        target_id=run_id, model=MODEL, error_type=ai_error_type(last_error),
        details={"retried": True},
    )
    raise HTTPException(
        422, "模型输出连续两次未通过严格结构或可靠性校验，已阻止展示"
    )


@router.get("/api/shadow-runs")
def list_shadow_runs(
    org_id: str | None = Query(default=None, alias="orgId"),
    limit: int = Query(default=100, ge=1, le=500),
    user: Identity = Depends(identity),
):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权查看影子运行")
    clauses, params = [], []
    if org_id:
        assert_org(user, org_id)
        clauses.append("org_id=?")
        params.append(org_id)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.fetch_all(
        "SELECT * FROM shadow_runs" + where + " ORDER BY created_at DESC LIMIT ?",
        (*params, limit),
    )
    return [
        {
            "id": row["id"], "agentRunId": row["agent_run_id"],
            "orgId": row["org_id"], "branch": row["branch"],
            "period": row["period"], "model": row["model"],
            "status": row["status"], "visibleToUser": bool(row["visible_to_user"]),
            "validationReport": db.load(row["validation_report"], {}),
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


@router.post("/api/human-reviews")
def create_human_review(
    body: HumanReviewInput, user: Identity = Depends(identity),
):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权提交人工评审")
    if body.orgId:
        assert_org(user, body.orgId)
    try:
        result = governance.add_human_review(
            target_id=body.targetId, target_type=body.targetType,
            org_id=body.orgId, reviewer_id=user.user_id, reviewer_role=user.role,
            factual_score=body.factualScore,
            relevance_score=body.relevanceScore,
            specificity_score=body.specificityScore,
            actionability_score=body.actionabilityScore,
            decision=body.decision, comment=body.comment,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit(
        user, "human.review.create", "success", org_id=body.orgId,
        target_id=result["id"], details={"decision": body.decision},
    )
    return result


@router.post("/api/release-gates")
def create_release_gate(
    body: ReleaseGateInput, user: Identity = Depends(identity),
):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可生成发布门禁")
    try:
        result = governance.create_release_gate(
            body.evaluationRunId, body.datasetVersion, user.user_id,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit(
        user, "release.gate.create",
        "passed" if result["passed"] else "blocked",
        target_id=result["id"],
        details={"blockers": result["blockers"]},
    )
    return result


@router.get("/api/pilot-metrics")
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
    shadow_stats = db.fetch_all(
        "SELECT status,COUNT(*) AS total FROM shadow_runs GROUP BY status"
    )
    review_stats = db.fetch_all(
        "SELECT decision,COUNT(*) AS total FROM human_reviews GROUP BY decision"
    )
    latest_gate = db.fetch_one(
        "SELECT * FROM release_gates ORDER BY created_at DESC"
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
        "shadowRuns": {
            row["status"]: row["total"] for row in shadow_stats
        },
        "humanReviews": {
            row["decision"]: row["total"] for row in review_stats
        },
        "latestEvaluation": (
            {
                "id": latest_eval["id"],
                "gatePassed": bool(latest_eval["gate_passed"]),
                "metrics": db.load(latest_eval["metrics"], {}),
            }
            if latest_eval else None
        ),
        "latestReleaseGate": (
            {
                "id": latest_gate["id"], "passed": bool(latest_gate["passed"]),
                "blockers": db.load(latest_gate["blockers"], []),
            }
            if latest_gate else None
        ),
    }
