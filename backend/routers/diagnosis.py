"""Diagnosis, interpretation, and evidence routes."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException

from ..shared import (
    AI_ENABLED,
    INTERPRETATION_PROMPT,
    MODEL,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    DiagnosisInput,
    EvidenceInput,
    Identity,
    audit,
    assert_branch,
    diagnosis_response,
    get_diagnosis,
    get_evidence_for_diagnosis,
    identity,
    new_id,
    now_iso,
    resolve_organization,
    ai_request,
    ai_error_type,
    runtime_value,
    rule_fallback,
    db,
)
from ..domain import METRIC_DIRECTIONS, validate_interpretation

router = APIRouter()


@router.post("/api/diagnoses")
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
            existing_metric = db.fetch_one(
                "SELECT * FROM metric_metadata WHERE metric_key=?", (item.metric,)
            )
            if existing_metric and existing_metric["metric_id"] != item.metricId:
                raise HTTPException(
                    422,
                    f"指标口径冲突：{item.metric} 已绑定"
                    f"{existing_metric['metric_id']}，不能改为{item.metricId}",
                )
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


@router.post("/api/diagnoses/{diagnosis_id}/interpretations")
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
                request_ai = runtime_value("ai_request", ai_request)
                content, usage = request_ai([
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


@router.get("/api/evidence/{evidence_id}")
def get_evidence(evidence_id: str, user: Identity = Depends(identity)):
    row = db.fetch_one("SELECT * FROM evidence WHERE id=?", (evidence_id,))
    if not row:
        raise HTTPException(404, "证据不存在")
    assert_branch(user, row["branch"])
    row["details"] = db.load(row.pop("payload"), {})
    return row
