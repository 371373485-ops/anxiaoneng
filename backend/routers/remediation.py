"""Remediation task routes (CRUD + reviews)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..shared import (
    ReviewInput,
    TaskInput,
    TaskPatch,
    Identity,
    assert_branch,
    audit,
    get_diagnosis,
    identity,
    new_id,
    now_iso,
    task_response,
    db,
)
from ..domain import (
    classify_review,
    next_task_state,
    validate_task_fields,
)

router = APIRouter()


@router.post("/api/remediation-tasks")
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


@router.patch("/api/remediation-tasks/{task_id}")
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
            incoming.pop(key)
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


@router.get("/api/remediation-tasks")
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


@router.post("/api/remediation-tasks/{task_id}/reviews")
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
