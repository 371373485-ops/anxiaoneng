from . import db
from .domain import new_id, now_iso
from .validation import build_validation_report, redact_sensitive


RELEASE_THRESHOLDS = {
    "numericAccuracy": 0.995,
    "evidenceValidityRate": 1.0,
    "organizationIsolationRate": 1.0,
    "unsupportedFactRate": 0.01,
    "relevanceRate": 0.90,
    "recommendationCompletenessRate": 0.95,
    "specificityRate": 0.95,
    "fallbackSuccessRate": 1.0,
    "criticalViolations": 0,
}


def _evidence_for(org_id, period):
    return db.fetch_all(
        """SELECT * FROM evidence WHERE org_id=? AND period=?
           ORDER BY metric""",
        (org_id, period),
    )


def create_shadow_run(
    *, agent_run_id, org_id, branch, period, goal, candidate_output,
    model, validation_policy, risk_level, user_id,
):
    clean_output = redact_sensitive(candidate_output)
    evidence = _evidence_for(org_id, period)
    report = build_validation_report(
        goal, clean_output, evidence, org_id, validation_policy, risk_level,
    )
    if not report.passed:
        status = "validation_failed"
    elif report.requiresHumanReview:
        status = "human_review_required"
    else:
        status = "validated"
    shadow_id = new_id("shadow")
    db.execute(
        """INSERT INTO shadow_runs
        (id,agent_run_id,org_id,branch,period,model,candidate_output,
         validation_report,status,visible_to_user,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            shadow_id, agent_run_id, org_id, branch, period, model,
            db.dump(clean_output), db.dump(report.model_dump()), status, 0,
            user_id, now_iso(),
        ),
    )
    return {
        "id": shadow_id,
        "agentRunId": agent_run_id,
        "status": status,
        "visibleToUser": False,
        "validationReport": report.model_dump(),
    }


def add_human_review(
    *, target_id, target_type, org_id, reviewer_id, reviewer_role,
    factual_score, relevance_score, specificity_score, actionability_score,
    decision, comment,
):
    if decision not in {"approved", "rejected", "needs_revision"}:
        raise ValueError("无效人工评审结论")
    scores = [
        factual_score, relevance_score, specificity_score, actionability_score,
    ]
    if any(score < 1 or score > 5 for score in scores):
        raise ValueError("人工评分必须在1至5分之间")
    review_id = new_id("humanreview")
    created_at = now_iso()
    db.execute(
        """INSERT INTO human_reviews
        (id,target_id,target_type,org_id,reviewer_id,reviewer_role,
         factual_score,relevance_score,specificity_score,actionability_score,
         decision,comment,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            review_id, target_id, target_type, org_id, reviewer_id, reviewer_role,
            factual_score, relevance_score, specificity_score, actionability_score,
            decision, comment, created_at,
        ),
    )
    return {
        "id": review_id, "targetId": target_id, "targetType": target_type,
        "decision": decision,
        "scores": {
            "factual": factual_score, "relevance": relevance_score,
            "specificity": specificity_score, "actionability": actionability_score,
        },
        "createdAt": created_at,
    }


def create_release_gate(evaluation_run_id, dataset_version, user_id):
    evaluation = db.fetch_one(
        "SELECT * FROM evaluation_runs WHERE id=?", (evaluation_run_id,)
    )
    if not evaluation:
        raise ValueError("评测运行不存在")
    metrics = db.load(evaluation["metrics"], {})
    metrics.setdefault("organizationIsolationRate", 1.0)
    metrics.setdefault(
        "unsupportedFactRate", metrics.get("unsupportedConclusionRate", 1.0)
    )
    metrics.setdefault("relevanceRate", 0.0)
    metrics.setdefault("specificityRate", 0.0)
    blockers = []
    for name, threshold in RELEASE_THRESHOLDS.items():
        actual = metrics.get(name)
        if actual is None:
            blockers.append(f"missing_metric:{name}")
        elif name in {"criticalViolations"}:
            if actual != threshold:
                blockers.append(f"{name}:{actual}")
        elif name in {"unsupportedFactRate"}:
            if actual > threshold:
                blockers.append(f"{name}:{actual}")
        elif actual < threshold:
            blockers.append(f"{name}:{actual}")
    gate_id = new_id("gate")
    created_at = now_iso()
    db.execute(
        """INSERT INTO release_gates
        (id,evaluation_run_id,dataset_version,metrics,blockers,passed,
         approved_by,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            gate_id, evaluation_run_id, dataset_version, db.dump(metrics),
            db.dump(blockers), int(not blockers), None, user_id, created_at,
        ),
    )
    return {
        "id": gate_id, "evaluationRunId": evaluation_run_id,
        "datasetVersion": dataset_version, "metrics": metrics,
        "blockers": blockers, "passed": not blockers, "createdAt": created_at,
    }
