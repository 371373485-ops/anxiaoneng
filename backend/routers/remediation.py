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
    METRIC_DIRECTIONS,
    classify_review,
    next_task_state,
    validate_task_fields,
)
from ..metric_catalog import get_metric_catalog_entry

router = APIRouter()


def _find_recommendation(diagnosis_payload, source_recommendation_id):
    if not source_recommendation_id:
        return None
    for item in diagnosis_payload.get("recommendations", []):
        if isinstance(item, dict) and item.get("id") == source_recommendation_id:
            return item
    raise HTTPException(422, "整改建议不存在，无法创建整改任务")


def _unique_ids(values):
    result = []
    for item in values or []:
        if item and item not in result:
            result.append(item)
    return result


def _validate_task_binding(body, diagnosis, recommendation):
    requested_metric_id = body.metricId or (recommendation or {}).get("metricId")
    requested_metric_key = body.metric or (recommendation or {}).get("metric")
    if body.metricId and recommendation and recommendation.get("metricId") and body.metricId != recommendation.get("metricId"):
        raise HTTPException(422, "整改任务指标与诊断建议指标不一致")
    if requested_metric_id:
        metadata = db.fetch_one("SELECT * FROM metric_metadata WHERE metric_id=?", (requested_metric_id,))
    elif requested_metric_key:
        metadata = db.fetch_one("SELECT * FROM metric_metadata WHERE metric_key=?", (requested_metric_key,))
    else:
        metadata = None
    if not metadata:
        raise HTTPException(422, "整改任务指标缺少有效元数据，无法确定改善方向")
    metric_id = metadata["metric_id"]
    direction = metadata["direction"]
    rec_evidence_ids = recommendation.get("evidenceIds", []) if isinstance(recommendation, dict) else []
    evidence_ids = _unique_ids(body.evidenceIds or rec_evidence_ids)
    if body.evidenceIds and rec_evidence_ids and set(body.evidenceIds) != set(rec_evidence_ids):
        raise HTTPException(422, "整改任务证据与诊断建议证据不一致")
    requires_review = bool(
        body.requiresEvidenceReview
        or (isinstance(recommendation, dict) and recommendation.get("requiresEvidenceReview"))
        or not evidence_ids
    )
    for evidence_id in evidence_ids:
        evidence = db.fetch_one(
            "SELECT * FROM evidence WHERE id=? AND diagnosis_id=?",
            (evidence_id, diagnosis["id"]),
        )
        if not evidence:
            raise HTTPException(422, "整改任务证据不存在或不属于当前诊断")
        if evidence["branch"] != diagnosis["branch"] or evidence["period"] != diagnosis["period"]:
            raise HTTPException(422, "整改任务证据与诊断机构或周期不一致")
        if not evidence["metric_id"] or evidence["metric_id"] != metric_id:
            raise HTTPException(422, "整改任务指标与证据指标不一致")
        if evidence["direction"] and evidence["direction"] != direction:
            raise HTTPException(422, "整改任务改善方向与证据方向不一致")
    return {
        "metadata": metadata,
        "metricId": metric_id,
        "metric": requested_metric_key or metadata["metric_key"],
        "direction": direction,
        "evidenceIds": evidence_ids,
        "bindingReason": body.bindingReason or (
            recommendation.get("bindingReason") if isinstance(recommendation, dict) else None
        ),
        "requiresEvidenceReview": requires_review,
    }


def _assert_task_has_confirmed_evidence(row):
    evidence_ids = db.load(row.get("evidence_ids") or "[]", [])
    if row.get("requires_evidence_review") or not evidence_ids:
        raise HTTPException(409, "该整改任务缺少有效证据，需先补充依据")


def _metadata_for_metric(metric_id=None, metric_key=None):
    if metric_id:
        row = db.fetch_one("SELECT * FROM metric_metadata WHERE metric_id=?", (metric_id,))
        if row:
            return row
    if metric_key:
        return db.fetch_one("SELECT * FROM metric_metadata WHERE metric_key=?", (metric_key,))
    return None


def _evidence_for_review(diagnosis_id, task):
    if task.get("metric_id"):
        evidence = db.fetch_one(
            "SELECT * FROM evidence WHERE diagnosis_id=? AND metric_id=?",
            (diagnosis_id, task["metric_id"]),
        )
        if evidence:
            return evidence
    if task.get("metric"):
        return db.fetch_one(
            "SELECT * FROM evidence WHERE diagnosis_id=? AND metric=?",
            (diagnosis_id, task["metric"]),
        )
    return None


def _review_metric_context(task, evidence):
    metric_id = (evidence or {}).get("metric_id") or task.get("metric_id")
    metric_key = (evidence or {}).get("metric") or task.get("metric")
    metadata = _metadata_for_metric(metric_id, metric_key)
    catalog = get_metric_catalog_entry(metric_id=metric_id, metric_key=metric_key)
    if evidence and evidence["direction"] in METRIC_DIRECTIONS:
        direction = evidence["direction"]
    elif metadata and metadata["direction"] in METRIC_DIRECTIONS:
        direction = metadata["direction"]
    elif catalog and catalog.get("direction") in METRIC_DIRECTIONS:
        direction = catalog["direction"]
    else:
        raise HTTPException(422, "复盘指标缺少可信改善方向，无法评价整改效果")
    target = task["target_value"]
    if target is None and direction == "target":
        if evidence and evidence["benchmark_value"] is not None:
            target = evidence["benchmark_value"]
        elif catalog and catalog.get("targetValue") is not None:
            target = catalog["targetValue"]
    return {"direction": direction, "target": target, "metadata": metadata, "catalog": catalog}


@router.post("/api/remediation-tasks")
@db.atomic
def create_task(body: TaskInput, user: Identity = Depends(identity)):
    diagnosis = get_diagnosis(body.diagnosisId, user)
    diagnosis_payload = db.load(diagnosis["payload"], {})
    recommendation = _find_recommendation(diagnosis_payload, body.sourceRecommendationId)
    binding = _validate_task_binding(body, diagnosis, recommendation)
    metadata = binding["metadata"]
    metric_id = binding["metricId"]
    direction = binding["direction"]
    task_id = new_id("task")
    timestamp = now_iso()
    db.execute(
        """INSERT INTO remediation_tasks
        (id,diagnosis_id,recommendation_index,source_recommendation_id,org_id,metric_id,
         branch,period,title,risk_metrics,
         description,action,owner_department,owner_name,due_date,current_value,
         target_value,metric,direction,evidence_ids,binding_reason,requires_evidence_review,
         status,created_by,created_at,updated_by,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            task_id, body.diagnosisId, body.recommendationIndex, body.sourceRecommendationId,
            diagnosis_payload.get("orgId"), metric_id, diagnosis["branch"],
            diagnosis["period"], body.title, db.dump(body.riskMetrics), body.description,
            body.action, body.ownerDepartment, body.ownerName, body.dueDate,
            body.currentValue, body.targetValue, binding["metric"] or metadata["metric_key"], direction,
            db.dump(binding["evidenceIds"]), binding["bindingReason"],
            1 if binding["requiresEvidenceReview"] else 0,
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
            if status in {"confirmed", "in_progress", "completed", "closed"}:
                _assert_task_has_confirmed_evidence(row)
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
    evidence = _evidence_for_review(body.diagnosisId, task)
    current = evidence["current_value"] if evidence else None
    review_context = _review_metric_context(task, evidence)
    result = classify_review(
        task["current_value"], current,
        review_context["direction"], review_context["target"],
    )
    previous_evidence = _evidence_for_review(task["diagnosis_id"], task)
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
