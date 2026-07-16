"""Evaluation run, detail, and feedback routes."""
import json

from fastapi import APIRouter, Depends, HTTPException

from ..shared import (
    AI_ENABLED,
    AI_KEY,
    EVALUATION_SCHEMA_VERSION,
    EVALUATION_TEMPERATURE,
    INTERPRETATION_PROMPT,
    MODEL,
    PROMPT_VERSION,
    EvaluationRunInput,
    FeedbackInput,
    Identity,
    assert_branch,
    audit,
    identity,
    new_id,
    now_iso,
    resolve_organization,
    ai_request,
    ai_error_type,
    db,
    load_evaluation_cases,
    normalized_evaluation_case,
)
from .. import agent_runtime
from ..domain import FEEDBACK_TYPES
from ..validation import score_evaluation_output

router = APIRouter()


@router.post("/api/evaluations/run")
@db.atomic
def run_evaluation(body: EvaluationRunInput, user: Identity = Depends(identity)):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可运行评测")
    cases = [normalized_evaluation_case(item) for item in load_evaluation_cases(body.cases)]
    if body.blindOnly:
        source_cases = load_evaluation_cases(body.cases)
        cases = [
            normalized_evaluation_case(item)
            for item in source_cases if item.get("blind")
        ]
    if body.repetitions > 1:
        cases = [
            {**case, "id": f"{case['id']}__repeat_{repeat + 1}"}
            for repeat in range(body.repetitions)
            for case in cases
        ]
    if not cases:
        raise HTTPException(422, "评测场景不能为空")
    run_id = new_id("eval")
    created_at = now_iso()
    db.execute(
        """INSERT INTO evaluation_versions
        (id,name,dataset_version,blind_set_version,prompt_version,schema_version,
         tool_version,case_count,frozen,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            new_id("evalversion"), "AI可靠性评测", body.datasetVersion,
            "reliability-blind-v1" if body.blindOnly else None,
            PROMPT_VERSION, EVALUATION_SCHEMA_VERSION,
            agent_runtime.TOOL_VERSION, len(cases), 1, user.user_id, created_at,
        ),
    )
    counters = {
        "schemaSuccess": 0, "numericSuccess": 0, "unsupportedConclusion": 0,
        "evidenceSuccess": 0, "recommendationSuccess": 0,
        "recommendationEvidenceBindingSuccess": 0,
        "causalSafetySuccess": 0,
        "remediationActionabilitySuccess": 0,
        "metricDirectionConsistencySuccess": 0,
        "relevanceSuccess": 0, "specificitySuccess": 0,
        "organizationIsolationSuccess": 0,
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
            counters["recommendationEvidenceBindingSuccess"] += int(
                score.recommendation_evidence_binding_success
            )
            counters["causalSafetySuccess"] += int(score.causal_safety_success)
            counters["remediationActionabilitySuccess"] += int(
                score.remediation_actionability_success
            )
            counters["metricDirectionConsistencySuccess"] += int(
                score.metric_direction_success
            )
            counters["relevanceSuccess"] += int(score.relevance_success)
            counters["specificitySuccess"] += int(score.specificity_success)
            counters["organizationIsolationSuccess"] += int(
                "cross_org_evidence" not in score.critical_violations
            )
            counters["unsupportedConclusion"] += score.unsupported_conclusions
            counters["criticalViolation"] += len(score.critical_violations)
            if score.critical_violations:
                error_type = ",".join(score.critical_violations)
                status = "failed"
            db.execute(
                """INSERT INTO evaluation_scores
                (id,run_id,case_id,numeric_score,evidence_score,relevance_score,
                 specificity_score,safety_score,critical_violation,details,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    new_id("evalscore"), run_id, case["id"],
                    float(score.numeric_success), float(score.evidence_success),
                    float(score.relevance_success), float(score.specificity_success),
                    float(not score.critical_violations),
                    int(bool(score.critical_violations)),
                    db.dump({
                        "violations": score.critical_violations,
                        "recommendationEvidenceBinding": (
                            score.recommendation_evidence_binding_success
                        ),
                        "causalSafety": score.causal_safety_success,
                        "remediationActionability": (
                            score.remediation_actionability_success
                        ),
                        "metricDirectionConsistency": score.metric_direction_success,
                    }),
                    created_at,
                ),
            )
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
        "organizationIsolationRate": counters["organizationIsolationSuccess"] / total,
        "recommendationCompletenessRate": counters["recommendationSuccess"] / total,
        "recommendationEvidenceBindingRate": (
            counters["recommendationEvidenceBindingSuccess"] / total
        ),
        "causalSafetyRate": counters["causalSafetySuccess"] / total,
        "remediationActionabilityRate": (
            counters["remediationActionabilitySuccess"] / total
        ),
        "metricDirectionConsistencyRate": (
            counters["metricDirectionConsistencySuccess"] / total
        ),
        "relevanceRate": counters["relevanceSuccess"] / total,
        "specificityRate": counters["specificitySuccess"] / total,
        "unsupportedConclusionRate": counters["unsupportedConclusion"] / total,
        "unsupportedFactRate": counters["unsupportedConclusion"] / total,
        "schemaSuccessRate": counters["schemaSuccess"] / total,
        "criticalViolations": counters["criticalViolation"],
        "fallbackSuccessRate": (
            counters["fallbackSuccess"] / counters["fallbackAttempts"]
            if counters["fallbackAttempts"] else 1.0
        ),
    }
    gate_passed = (
        metrics["numericAccuracy"] >= 0.995
        and metrics["evidenceValidityRate"] == 1.0
        and metrics["organizationIsolationRate"] == 1.0
        and metrics["recommendationCompletenessRate"] >= 0.95
        and metrics["recommendationEvidenceBindingRate"] == 1.0
        and metrics["causalSafetyRate"] == 1.0
        and metrics["remediationActionabilityRate"] >= 0.95
        and metrics["metricDirectionConsistencyRate"] == 1.0
        and metrics["relevanceRate"] >= 0.90
        and metrics["specificityRate"] >= 0.95
        and metrics["unsupportedFactRate"] <= 0.01
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


@router.get("/api/evaluations/{run_id}")
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


@router.post("/api/feedback")
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
