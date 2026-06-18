import hashlib
import json
import time
from typing import Any

from . import db
from .domain import new_id, now_iso
from .schemas import AgentOutput, AgentPlan, AgentStep, Fact, Recommendation, ToolResult
from .validation import build_validation_report, redact_sensitive


AGENT_PROMPT_VERSION = "agent-orchestrator-v1"
AGENT_SCHEMA_VERSION = "agent-run-v2"
TOOL_VERSION = "business-tools-v2"


def _hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _rows_to_public(rows):
    return [
        {
            "id": row["id"],
            "orgId": row["org_id"],
            "branch": row["branch"],
            "period": row["period"],
            "metric": row["metric"],
            "metricId": row.get("metric_id") or row["metric"],
            "label": row["label"],
            "value": row["current_value"],
            "benchmarkValue": row["benchmark_value"],
            "differenceValue": row["difference_value"],
            "unit": row["unit"] or "",
            "direction": row.get("direction") or "neutral",
            "calculationVersion": row.get("calculation_version") or "calc-v1",
            "source": row["source"],
        }
        for row in rows
    ]


def _metric_rows(org_id, period, metric_ids=None):
    clauses = ["org_id=?", "period=?"]
    params: list[Any] = [org_id, period]
    if metric_ids:
        placeholders = ",".join("?" for _ in metric_ids)
        clauses.append(f"(metric_id IN ({placeholders}) OR metric IN ({placeholders}))")
        params.extend(metric_ids)
        params.extend(metric_ids)
    return db.fetch_all(
        "SELECT * FROM evidence WHERE " + " AND ".join(clauses) + " ORDER BY metric",
        tuple(params),
    )


def get_metric_snapshot(context):
    rows = _metric_rows(
        context["orgId"], context["period"], context.get("metricIds") or None
    )
    return {
        "metrics": _rows_to_public(rows),
        "calculationVersion": (
            rows[0].get("calculation_version") if rows else "unknown"
        ) or "unknown",
        "source": "evidence_snapshot",
    }


def calculate_metric(context):
    snapshot = get_metric_snapshot(context)
    return {
        "metrics": snapshot["metrics"],
        "calculationMode": "deterministic",
        "calculationVersion": snapshot["calculationVersion"],
        "source": "metric_service",
        "note": "所有数值来自已保存证据和确定性计算结果，模型未参与计算。",
    }


def compare_trend(context):
    metric_ids = context.get("metricIds") or []
    clauses = ["org_id=?", "period<=?"]
    params: list[Any] = [context["orgId"], context["period"]]
    if metric_ids:
        placeholders = ",".join("?" for _ in metric_ids)
        clauses.append(f"(metric_id IN ({placeholders}) OR metric IN ({placeholders}))")
        params.extend(metric_ids)
        params.extend(metric_ids)
    rows = db.fetch_all(
        "SELECT * FROM evidence WHERE " + " AND ".join(clauses)
        + " ORDER BY metric,period DESC",
        tuple(params),
    )
    grouped = {}
    for item in _rows_to_public(rows):
        grouped.setdefault(item["metricId"], []).append(item)
    return {
        "series": grouped, "causalityClaimed": False,
        "calculationVersion": "trend-v1", "source": "evidence_snapshot",
    }


def compare_benchmark(context):
    metrics = get_metric_snapshot(context)["metrics"]
    return {
        "comparisons": [
            {
                **item,
                "benchmarkObject": "saved_benchmark",
                "differenceValue": item["differenceValue"],
            }
            for item in metrics
        ],
        "calculationVersion": "benchmark-v1",
        "source": "evidence_snapshot",
    }


def get_evidence(context):
    snapshot = get_metric_snapshot(context)
    return {
        "evidence": snapshot["metrics"],
        "calculationVersion": snapshot["calculationVersion"],
        "source": "evidence_snapshot",
    }


def create_remediation_draft(context):
    return {
        "status": "confirmation_required",
        "requiresConfirmation": True,
        "requiredFields": [
            "ownerDepartment", "ownerName", "dueDate", "targetValue",
        ],
        "message": "仅生成整改草稿；用户确认责任人与目标后才能创建正式任务。",
        "calculationVersion": "remediation-v1",
        "source": "remediation_service",
    }


def review_remediation(context):
    task_id = context.get("taskId")
    if not task_id:
        return {
            "status": "waiting_user",
            "missingInputs": ["taskId"],
            "message": "复盘需要指定整改任务。",
            "calculationVersion": "review-v1",
            "source": "remediation_service",
        }
    rows = db.fetch_all(
        "SELECT * FROM remediation_reviews WHERE task_id=? ORDER BY created_at DESC",
        (task_id,),
    )
    return {
        "reviews": rows,
        "limitation": "指标变化仅表示相关性，不代表整改措施与结果之间存在确定因果关系。",
        "calculationVersion": "review-v1",
        "source": "remediation_service",
    }


TOOLS: dict[str, dict[str, Any]] = {
    "get_metric_snapshot": {
        "description": "读取指定机构、周期和指标的确定性快照",
        "handler": get_metric_snapshot,
    },
    "calculate_metric": {
        "description": "返回确定性指标计算结果及计算版本",
        "handler": calculate_metric,
    },
    "compare_trend": {
        "description": "比较跨周期变化，不推断因果",
        "handler": compare_trend,
    },
    "compare_benchmark": {
        "description": "与保存的计划、整体或同类机构基准比较",
        "handler": compare_benchmark,
    },
    "get_evidence": {
        "description": "读取当前授权机构的证据快照",
        "handler": get_evidence,
    },
    "create_remediation_draft": {
        "description": "生成需要人工确认的整改草稿",
        "handler": create_remediation_draft,
    },
    "review_remediation": {
        "description": "读取整改任务复盘结果并声明因果边界",
        "handler": review_remediation,
    },
}


def tool_catalog():
    return [
        {
            "name": name,
            "version": TOOL_VERSION,
            "description": definition["description"],
            "deterministic": True,
        }
        for name, definition in TOOLS.items()
    ]


def build_plan(goal, context):
    missing = [
        field for field in ("orgId", "branch", "period")
        if not context.get(field)
    ]
    requested = context.get("taskType") or "analysis"
    tools = ["get_metric_snapshot", "compare_trend", "compare_benchmark", "get_evidence"]
    if requested == "remediation":
        tools.append("create_remediation_draft")
    elif requested == "review":
        tools.append("review_remediation")
    steps = [
        AgentStep(
            id=new_id("step"),
            title=TOOLS[name]["description"],
            toolName=name,
            input=redact_sensitive(context),
        )
        for name in tools[:6]
    ]
    return AgentPlan(
        goal=goal,
        steps=steps,
        requiredTools=[step.toolName for step in steps],
        status="waiting_user" if missing else "planned",
        missingInputs=missing,
    )


def create_run(payload, user_id):
    clean = redact_sensitive(payload)
    goal = str(clean.get("goal") or "").strip()
    if not goal:
        raise ValueError("goal不能为空")
    idempotency_key = clean.get("idempotencyKey") or _hash(
        {
            "user": user_id,
            "orgId": clean.get("orgId"),
            "period": clean.get("period"),
            "goal": goal,
        }
    )
    existing = db.fetch_one(
        "SELECT * FROM agent_runs WHERE idempotency_key=?", (idempotency_key,)
    )
    if existing:
        return run_response(existing["id"])

    plan = build_plan(goal, clean)
    risk_level = clean.get("riskLevel") or "medium"
    validation_policy = clean.get("validationPolicy") or "strict"
    run_id = new_id("run")
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """INSERT INTO agent_runs
            (id,org_id,branch,period,goal,goal_payload,plan,result,status,
             idempotency_key,model,prompt_version,schema_version,tool_version,
             error_type,risk_level,validation_policy,validation_report,execution_mode,
             created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                run_id, clean.get("orgId") or "", clean.get("branch") or "",
                clean.get("period") or "", goal, db.dump(clean), db.dump(plan.model_dump()),
                None, plan.status, idempotency_key, "deterministic-orchestrator",
                AGENT_PROMPT_VERSION, AGENT_SCHEMA_VERSION, TOOL_VERSION, None,
                risk_level, validation_policy, None,
                clean.get("executionMode") or "deterministic",
                user_id, timestamp, timestamp,
            ),
        )
        for index, step in enumerate(plan.steps):
            tx.execute(
                """INSERT INTO agent_steps
                (id,run_id,step_index,title,tool_name,input_payload,output_payload,
                 status,error_type,started_at,completed_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    step.id, run_id, index, step.title, step.toolName,
                    db.dump(step.input), None, step.status, None, None, None,
                ),
            )
        memory_payload = {
            "goal": goal,
            "period": clean.get("period"),
            "metricIds": clean.get("metricIds") or [],
            "outputFormat": clean.get("outputFormat") or "structured",
        }
        tx.execute(
            """INSERT INTO agent_memories
            (id,org_id,user_id,memory_type,memory_key,payload,source_id,active,
             created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(org_id,user_id,memory_type,memory_key) DO UPDATE SET
            payload=excluded.payload,source_id=excluded.source_id,active=1,
            updated_at=excluded.updated_at""",
            (
                new_id("memory"), clean.get("orgId") or "", user_id, "session",
                "latest_agent_goal", db.dump(memory_payload), run_id, 1,
                user_id, timestamp, timestamp,
            ),
        )
    if plan.status == "waiting_user":
        return run_response(run_id)
    execute_run(run_id, user_id)
    return run_response(run_id)


def _execute_tool(run, step, user_id):
    tool_name = step["tool_name"]
    definition = TOOLS.get(tool_name)
    if not definition:
        raise ValueError(f"工具未在白名单注册：{tool_name}")
    input_payload = db.load(step["input_payload"], {})
    input_hash = _hash(input_payload)
    previous = db.fetch_one(
        "SELECT * FROM tool_executions WHERE run_id=? AND step_id=? AND input_hash=?",
        (run["id"], step["id"], input_hash),
    )
    if previous and previous["status"] == "success":
        cached = db.load(previous["output_payload"], {})
        return cached.get("output", cached)

    started = time.monotonic()
    output = definition["handler"](input_payload)
    latency = int((time.monotonic() - started) * 1000)
    tool_result = ToolResult(
        toolName=tool_name,
        inputHash=input_hash,
        output=output,
        status="success",
        latencyMs=latency,
        calculationVersion=output.get("calculationVersion") or TOOL_VERSION,
        source=output.get("source") or tool_name,
    ).model_dump()
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """INSERT INTO tool_executions
            (id,run_id,step_id,org_id,tool_name,tool_version,input_hash,input_payload,
             output_payload,status,latency_ms,calculation_version,source,error_type,
             created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                new_id("tool"), run["id"], step["id"], run["org_id"], tool_name,
                TOOL_VERSION, input_hash, db.dump(input_payload), db.dump(tool_result),
                "success", latency, tool_result["calculationVersion"],
                tool_result["source"], None, user_id, timestamp,
            ),
        )
        tx.execute(
            """UPDATE agent_steps SET output_payload=?,status='completed',
               completed_at=? WHERE id=?""",
            (db.dump(tool_result), timestamp, step["id"]),
        )
    return output


def _compose_result(run_id):
    run = db.fetch_one("SELECT * FROM agent_runs WHERE id=?", (run_id,))
    evidence_rows = _metric_rows(
        run["org_id"], run["period"],
        db.load(run["goal_payload"], {}).get("metricIds") or None,
    )
    facts = []
    evidence_ids = []
    for row in evidence_rows:
        metric_id = row.get("metric_id") or row["metric"]
        evidence_ids.append(row["id"])
        facts.append(
            Fact(
                id=new_id("fact"),
                text=f"{row['label']}当前值为已保存的确定性结果。",
                evidenceIds=[row["id"]],
                metricId=metric_id,
                value=row["current_value"],
                unit=row["unit"] or "",
            )
        )

    diagnosis = db.fetch_one(
        """SELECT * FROM diagnoses WHERE org_id=? AND period=?
           ORDER BY created_at DESC""",
        (run["org_id"], run["period"]),
    )
    recommendations = []
    if diagnosis:
        payload = db.load(diagnosis["payload"], {})
        for index, item in enumerate(payload.get("recommendations", [])):
            if not isinstance(item, dict):
                continue
            metric_id = item.get("metricId") or item.get("metric")
            matching = [
                row for row in evidence_rows
                if metric_id in (row.get("metric_id"), row.get("metric"))
            ]
            if not metric_id or not matching:
                continue
            recommendations.append(
                Recommendation(
                    id=item.get("id") or f"rec_{index + 1}",
                    title=item.get("title") or "经营改善建议",
                    action=item.get("action") or item.get("text") or "请结合证据制定整改动作",
                    metricId=metric_id,
                    direction=matching[0].get("direction") or "neutral",
                    evidenceIds=[matching[0]["id"]],
                    ownerRole=item.get("ownerRole") or "经营管理",
                    period=item.get("period") or run["period"],
                )
            )
    return AgentOutput(
        summary=(
            "已完成确定性指标、趋势、对标和证据分析。"
            if facts else "当前授权机构和周期没有可用证据，无法形成确定性经营结论。"
        ),
        facts=facts,
        recommendations=recommendations,
        limitations=(
            ["指标变化与整改措施仅能说明相关性，不能据此宣称确定因果关系。"]
            if facts else ["缺少当前机构和周期的证据数据。"]
        ),
        evidenceIds=evidence_ids,
    ).model_dump()


def execute_run(run_id, user_id):
    run = db.fetch_one("SELECT * FROM agent_runs WHERE id=?", (run_id,))
    if not run:
        raise ValueError("智能体任务不存在")
    if run["status"] == "cancelled":
        return
    db.execute(
        "UPDATE agent_runs SET status='running',updated_at=? WHERE id=?",
        (now_iso(), run_id),
    )
    steps = db.fetch_all(
        "SELECT * FROM agent_steps WHERE run_id=? ORDER BY step_index", (run_id,)
    )
    try:
        for step in steps:
            current = db.fetch_one("SELECT status FROM agent_runs WHERE id=?", (run_id,))
            if current["status"] == "cancelled":
                return
            db.execute(
                "UPDATE agent_steps SET status='running',started_at=? WHERE id=?",
                (now_iso(), step["id"]),
            )
            output = _execute_tool(run, step, user_id)
            if output.get("status") == "waiting_user":
                plan = db.load(run["plan"], {})
                plan["status"] = "waiting_user"
                plan["missingInputs"] = output.get("missingInputs", [])
                db.execute(
                    """UPDATE agent_runs SET status='waiting_user',plan=?,updated_at=?
                       WHERE id=?""",
                    (db.dump(plan), now_iso(), run_id),
                )
                return
        result = _compose_result(run_id)
        evidence_rows = _metric_rows(
            run["org_id"], run["period"],
            db.load(run["goal_payload"], {}).get("metricIds") or None,
        )
        if not result.get("facts"):
            report = build_validation_report(
                run["goal"], result, evidence_rows, run["org_id"],
                run.get("validation_policy") or "strict",
                run.get("risk_level") or "medium",
            )
            result["validationReport"] = report.model_dump()
            db.execute(
                """UPDATE agent_runs SET result=?,validation_report=?,
                   status='insufficient_evidence',updated_at=? WHERE id=?""",
                (db.dump(result), db.dump(report.model_dump()), now_iso(), run_id),
            )
            return
        report = build_validation_report(
            run["goal"], result, evidence_rows, run["org_id"],
            run.get("validation_policy") or "strict",
            run.get("risk_level") or "medium",
        )
        result["validationReport"] = report.model_dump()
        if not report.passed:
            safe_result = {
                "summary": "生成内容未通过可靠性校验，已阻止展示。",
                "facts": [], "inferences": [], "recommendations": [],
                "limitations": ["请查看校验报告或使用规则诊断结果。"],
                "evidenceIds": [],
                "validationReport": report.model_dump(),
                "degraded": True,
                "schemaVersion": result.get("schemaVersion"),
            }
            db.execute(
                """UPDATE agent_runs SET result=?,validation_report=?,
                   status='validation_failed',error_type='validation_failed',
                   updated_at=? WHERE id=?""",
                (
                    db.dump(safe_result), db.dump(report.model_dump()),
                    now_iso(), run_id,
                ),
            )
            return
        final_status = (
            "human_review_required" if report.requiresHumanReview else "completed"
        )
        db.execute(
            """UPDATE agent_runs SET result=?,validation_report=?,status=?,updated_at=?
               WHERE id=?""",
            (
                db.dump(result), db.dump(report.model_dump()),
                final_status, now_iso(), run_id,
            ),
        )
    except Exception as exc:
        db.execute(
            """UPDATE agent_runs SET status='failed',error_type=?,updated_at=?
               WHERE id=?""",
            (type(exc).__name__, now_iso(), run_id),
        )
        raise


def add_inputs(run_id, inputs, user_id):
    run = db.fetch_one("SELECT * FROM agent_runs WHERE id=?", (run_id,))
    if not run:
        raise ValueError("智能体任务不存在")
    if run["status"] not in {
        "waiting_user", "failed", "insufficient_evidence", "validation_failed",
    }:
        raise ValueError("当前状态不允许补充输入")
    payload = db.load(run["goal_payload"], {})
    payload.update(redact_sensitive(inputs))
    plan = build_plan(run["goal"], payload)
    with db.transaction() as tx:
        tx.execute(
            """UPDATE agent_runs SET org_id=?,branch=?,period=?,goal_payload=?,plan=?,
               status=?,error_type=NULL,updated_at=? WHERE id=?""",
            (
                payload.get("orgId") or "", payload.get("branch") or "",
                payload.get("period") or "", db.dump(payload), db.dump(plan.model_dump()),
                plan.status, now_iso(), run_id,
            ),
        )
        tx.execute("DELETE FROM agent_steps WHERE run_id=?", (run_id,))
        for index, step in enumerate(plan.steps):
            tx.execute(
                """INSERT INTO agent_steps
                (id,run_id,step_index,title,tool_name,input_payload,output_payload,
                 status,error_type,started_at,completed_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    step.id, run_id, index, step.title, step.toolName,
                    db.dump(step.input), None, step.status, None, None, None,
                ),
            )
    if plan.status != "waiting_user":
        execute_run(run_id, user_id)
    return run_response(run_id)


def cancel_run(run_id):
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """UPDATE agent_runs SET status='cancelled',updated_at=?
               WHERE id=? AND status NOT IN ('completed','cancelled')""",
            (timestamp, run_id),
        )
        tx.execute(
            """UPDATE agent_steps SET status='cancelled',completed_at=?
               WHERE run_id=? AND status IN ('planned','running','waiting_user')""",
            (timestamp, run_id),
        )
    return run_response(run_id)


def run_response(run_id):
    run = db.fetch_one("SELECT * FROM agent_runs WHERE id=?", (run_id,))
    if not run:
        return None
    steps = db.fetch_all(
        "SELECT * FROM agent_steps WHERE run_id=? ORDER BY step_index", (run_id,)
    )
    return {
        "id": run["id"],
        "orgId": run["org_id"],
        "branch": run["branch"],
        "period": run["period"],
        "goal": run["goal"],
        "status": run["status"],
        "plan": db.load(run["plan"], {}),
        "result": db.load(run["result"], None),
        "errorType": run["error_type"],
        "riskLevel": run.get("risk_level") or "medium",
        "validationPolicy": run.get("validation_policy") or "strict",
        "validationReport": db.load(run.get("validation_report"), None),
        "executionMode": run.get("execution_mode") or "deterministic",
        "versions": {
            "prompt": run["prompt_version"],
            "schema": run["schema_version"],
            "tools": run["tool_version"],
            "model": run["model"],
        },
        "steps": [
            {
                "id": step["id"],
                "index": step["step_index"],
                "title": step["title"],
                "toolName": step["tool_name"],
                "status": step["status"],
                "output": db.load(step["output_payload"], None),
                "errorType": step["error_type"],
            }
            for step in steps
        ],
        "createdAt": run["created_at"],
        "updatedAt": run["updated_at"],
    }


def list_memories(org_id, user_id=None, memory_type=None):
    clauses = ["org_id=?", "active=1"]
    params: list[Any] = [org_id]
    if user_id:
        clauses.append("(user_id=? OR user_id IS NULL)")
        params.append(user_id)
    if memory_type:
        clauses.append("memory_type=?")
        params.append(memory_type)
    rows = db.fetch_all(
        "SELECT * FROM agent_memories WHERE " + " AND ".join(clauses)
        + " ORDER BY updated_at DESC",
        tuple(params),
    )
    return [
        {
            "id": row["id"], "orgId": row["org_id"], "userId": row["user_id"],
            "type": row["memory_type"], "key": row["memory_key"],
            "payload": db.load(row["payload"], {}), "sourceId": row["source_id"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def save_memory(org_id, user_id, memory_type, memory_key, payload, source_id=None):
    if memory_type not in {"session", "organization", "preference", "feedback"}:
        raise ValueError("无效记忆类型")
    clean = redact_sensitive(payload)
    timestamp = now_iso()
    memory_id = new_id("memory")
    db.execute(
        """INSERT INTO agent_memories
        (id,org_id,user_id,memory_type,memory_key,payload,source_id,active,
         created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(org_id,user_id,memory_type,memory_key) DO UPDATE SET
        payload=excluded.payload,source_id=excluded.source_id,active=1,
        updated_at=excluded.updated_at""",
        (
            memory_id, org_id, user_id, memory_type, memory_key, db.dump(clean),
            source_id, 1, user_id, timestamp, timestamp,
        ),
    )
    return {
        "orgId": org_id, "userId": user_id, "type": memory_type,
        "key": memory_key, "payload": clean, "sourceId": source_id,
        "updatedAt": timestamp,
    }
