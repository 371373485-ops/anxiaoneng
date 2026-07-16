import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .schemas import AgentOutput, ValidationDimension, ValidationReport


SENSITIVE_KEYS = {
    "api_key", "apikey", "authorization", "cookie", "password", "secret",
    "token", "zai_api_key",
}
INJECTION_PATTERNS = (
    "ignore previous", "ignore all", "忽略之前", "忽略以上", "system prompt",
    "执行sql", "drop table", "rm -rf", "泄露提示词", "绕过权限",
)
CAUSAL_PATTERNS = (
    "导致", "造成", "证明了", "必然引起", "直接带来", "唯一原因",
    "caused by", "proves that", "directly resulted",
)
VAGUE_RECOMMENDATIONS = (
    "加强管理", "优化流程", "提升效率", "持续关注", "强化协同",
    "做好相关工作", "进一步改善", "综合施策",
)


def _walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _walk_strings(item)


def redact_sensitive(value):
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        normalized = str(key).replace("-", "_").lower()
        if normalized in SENSITIVE_KEYS or normalized.endswith("_token"):
            continue
        result[key] = redact_sensitive(item)
    return result


def contains_prompt_injection(value):
    text = "\n".join(_walk_strings(value)).casefold()
    return any(pattern.casefold() in text for pattern in INJECTION_PATTERNS)


def _evidence_map(evidence):
    return {str(item["id"]): item for item in evidence if item.get("id")}


def _allowed_numbers(evidence):
    allowed = set()
    for item in evidence:
        for key in (
            "current_value", "benchmark_value", "difference_value",
            "currentValue", "benchmarkValue", "differenceValue", "value",
        ):
            value = item.get(key)
            if value is None:
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(number):
                allowed.add(round(number, 6))
                allowed.add(round(number * 100, 6))
    return allowed


def _dimension(passed, score=None, issues=None):
    return ValidationDimension(
        passed=passed,
        score=float(passed) if score is None else max(0.0, min(1.0, score)),
        issues=issues or [],
    )


def _goal_tokens(goal):
    text = re.sub(r"[\s，。！？、；：,.!?;:（）()]+", "", str(goal or "").casefold())
    tokens = set(re.findall(r"[a-z0-9_]{2,}", text))
    tokens.update(text[index:index + 2] for index in range(max(0, len(text) - 1)))
    return {token for token in tokens if token}


def _claim_text(output):
    parts = [output.summary, *output.limitations]
    parts.extend(item.text for item in output.facts)
    for item in output.inferences:
        parts.append(item.text)
        parts.extend(item.limitations)
    for item in output.recommendations:
        parts.extend([item.title, item.action])
    return "\n".join(parts)


def build_validation_report(
    goal, payload, evidence, expected_org_id=None, policy="strict", risk_level="medium",
):
    blockers = []
    warnings = []
    try:
        output = AgentOutput.model_validate(payload)
    except ValidationError:
        failed = _dimension(False, 0, ["输出不符合 AgentOutput Schema"])
        return ValidationReport(
            passed=False, policy=policy,
            numericAccuracy=failed, evidenceValidity=failed,
            organizationIsolation=failed, metricConsistency=failed,
            relevance=failed, specificity=failed, causalSafety=failed,
            security=failed, blockers=["invalid_schema"],
            requiresHumanReview=True,
        )

    evidence_by_id = _evidence_map(evidence)
    allowed_numbers = _allowed_numbers(evidence)
    numeric_issues = []
    evidence_issues = []
    org_issues = []
    metric_issues = []
    referenced = set(output.evidenceIds)

    for item in [*output.facts, *output.inferences, *output.recommendations]:
        referenced.update(item.evidenceIds)
    for evidence_id in referenced:
        source = evidence_by_id.get(evidence_id)
        if not source:
            evidence_issues.append(f"无效证据ID：{evidence_id}")
            continue
        source_org = source.get("org_id", source.get("orgId"))
        if expected_org_id and source_org not in (None, expected_org_id):
            org_issues.append(f"证据 {evidence_id} 不属于当前机构")

    for fact in output.facts:
        sources = [evidence_by_id.get(item) for item in fact.evidenceIds]
        sources = [item for item in sources if item]
        if fact.value is not None and round(float(fact.value), 6) not in allowed_numbers:
            numeric_issues.append(f"事实 {fact.id} 的数字无证据支持")
        for source in sources:
            source_metric = (
                source.get("metric_id", source.get("metricId")) or source.get("metric")
            )
            if source_metric and source_metric != fact.metricId:
                metric_issues.append(f"事实 {fact.id} 的指标与证据不一致")
            if (source.get("unit") or "") != fact.unit:
                metric_issues.append(f"事实 {fact.id} 的单位与证据不一致")

    for recommendation in output.recommendations:
        sources = [evidence_by_id.get(item) for item in recommendation.evidenceIds]
        for source in [item for item in sources if item]:
            source_metric = (
                source.get("metric_id", source.get("metricId")) or source.get("metric")
            )
            if source_metric and source_metric != recommendation.metricId:
                metric_issues.append(f"建议 {recommendation.id} 的指标与证据不一致")
            if source.get("direction") and source["direction"] != recommendation.direction:
                metric_issues.append(f"建议 {recommendation.id} 的改善方向错误")

    all_text = _claim_text(output)
    unsupported_numbers = []
    for token in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?", all_text):
        number = round(float(token), 6)
        if number not in allowed_numbers and number not in {0, 1, 2, 3, 6, 12, 100}:
            unsupported_numbers.append(token)
    if unsupported_numbers:
        numeric_issues.append("存在无证据数字：" + "、".join(sorted(set(unsupported_numbers))))

    goal_tokens = _goal_tokens(goal)
    answer_tokens = _goal_tokens(all_text)
    overlap = len(goal_tokens & answer_tokens) / max(1, len(goal_tokens))
    relevance_issues = (
        [] if not goal_tokens or overlap >= 0.15 else ["回答与用户目标相关性不足"]
    )

    specificity_issues = []
    for recommendation in output.recommendations:
        if any(phrase in recommendation.action for phrase in VAGUE_RECOMMENDATIONS):
            specificity_issues.append(f"建议 {recommendation.id} 包含空泛动作")
        if len(recommendation.action.strip()) < 12:
            specificity_issues.append(f"建议 {recommendation.id} 动作不够具体")

    causal_issues = [
        phrase for phrase in CAUSAL_PATTERNS if phrase.casefold() in all_text.casefold()
    ]
    security_issues = ["输出包含疑似注入内容"] if contains_prompt_injection(payload) else []

    for code, issues in {
        "unsupported_number": numeric_issues,
        "invalid_evidence": evidence_issues,
        "cross_org_evidence": org_issues,
        "metric_mismatch": metric_issues,
        "causal_claim": causal_issues,
        "security_violation": security_issues,
        "low_relevance": relevance_issues,
    }.items():
        if issues:
            blockers.append(code)
    if specificity_issues:
        if policy == "strict":
            blockers.append("vague_recommendation")
        else:
            warnings.extend(specificity_issues)

    requires_review = bool(
        str(risk_level).lower() in {"high", "critical", "高风险", "严重"}
        or relevance_issues or specificity_issues or causal_issues
        or any(item.confidence < 0.7 for item in output.inferences)
    )
    return ValidationReport(
        passed=not blockers,
        policy=policy,
        numericAccuracy=_dimension(not numeric_issues, issues=numeric_issues),
        evidenceValidity=_dimension(not evidence_issues, issues=evidence_issues),
        organizationIsolation=_dimension(not org_issues, issues=org_issues),
        metricConsistency=_dimension(not metric_issues, issues=metric_issues),
        relevance=_dimension(
            not relevance_issues, overlap if goal_tokens else 1, relevance_issues,
        ),
        specificity=_dimension(
            not specificity_issues,
            max(0, 1 - len(specificity_issues) / max(1, len(output.recommendations))),
            specificity_issues,
        ),
        causalSafety=_dimension(not causal_issues, issues=causal_issues),
        security=_dimension(not security_issues, issues=security_issues),
        blockers=list(dict.fromkeys(blockers)),
        warnings=warnings,
        requiresHumanReview=requires_review,
    )


def validate_agent_output(payload, evidence, expected_org_id=None):
    report = build_validation_report(
        "", payload, evidence, expected_org_id, policy="strict",
    )
    if not report.passed:
        raise ValueError("AI输出未通过可靠性门禁：" + "、".join(report.blockers))
    output = AgentOutput.model_validate(payload)
    return output.model_dump()


def validate_and_attach_report(
    goal, payload, evidence, expected_org_id=None, policy="strict", risk_level="medium",
):
    report = build_validation_report(
        goal, payload, evidence, expected_org_id, policy, risk_level,
    )
    result = dict(payload)
    result["validationReport"] = report.model_dump()
    if not report.passed:
        raise ValueError(json.dumps({
            "message": "AI输出未通过可靠性门禁",
            "validationReport": report.model_dump(),
        }, ensure_ascii=False))
    return AgentOutput.model_validate(result).model_dump()


def validate_interpretation_payload(payload, evidence):
    required = {
        "summary", "facts", "inferences",
        "investigations", "recommendations", "limitations",
    }
    if not isinstance(payload, dict) or not required.issubset(payload):
        raise ValueError("AI返回结构不符合 interpretation Schema")
    if not isinstance(payload["summary"], str):
        raise ValueError("summary必须为字符串")
    for name in required - {"summary"}:
        if not isinstance(payload[name], list):
            raise ValueError(f"{name}必须为数组")

    evidence_by_id = _evidence_map(evidence)
    allowed_numbers = _allowed_numbers(evidence)
    for fact in payload["facts"]:
        if not isinstance(fact, dict) or fact.get("evidenceId") not in evidence_by_id:
            raise ValueError("事实缺少有效证据ID")
        source = evidence_by_id[fact["evidenceId"]]
        value = fact.get("currentValue")
        source_value = source.get("current_value", source.get("currentValue"))
        if value is not None and source_value is not None:
            if abs(float(value) - float(source_value)) > 1e-6:
                raise ValueError("AI事实数字与证据不一致")
    for text in _walk_strings(payload):
        for token in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?", text):
            number = round(float(token), 6)
            if number not in allowed_numbers and number not in {0, 1, 2, 3, 6, 12, 100}:
                raise ValueError(f"AI输出包含无证据数字：{token}")
    return payload


@dataclass
class EvaluationScore:
    schema_success: bool = False
    numeric_success: bool = False
    evidence_success: bool = False
    recommendation_success: bool = False
    recommendation_evidence_binding_success: bool = False
    causal_safety_success: bool = False
    remediation_actionability_success: bool = False
    metric_direction_success: bool = False
    relevance_success: bool = False
    specificity_success: bool = False
    unsupported_conclusions: int = 0
    critical_violations: list[str] = field(default_factory=list)


def _append_violation(score: EvaluationScore, code: str) -> None:
    if code not in score.critical_violations:
        score.critical_violations.append(code)


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _expected_metric_ids(case: dict) -> set[str]:
    metric_ids = set()
    snapshot = case.get("inputSnapshot", {})
    if isinstance(snapshot, dict):
        for key in ("metricId", "metric_id"):
            if snapshot.get(key):
                metric_ids.add(str(snapshot[key]))
    for item in _as_list(case.get("requiredMetrics")):
        if isinstance(item, dict):
            metric_id = item.get("metricId") or item.get("metric_id")
            if metric_id:
                metric_ids.add(str(metric_id))
    return metric_ids


def _expected_metric_direction(case: dict) -> str | None:
    snapshot = case.get("inputSnapshot", {})
    if isinstance(snapshot, dict):
        direction = snapshot.get("metricDirection") or snapshot.get("direction")
        if direction:
            return str(direction)
    for item in _as_list(case.get("requiredMetrics")):
        if isinstance(item, dict) and item.get("direction"):
            return str(item["direction"])
    return None


def _evidence_ids_from(item: dict) -> set[str]:
    evidence_ids = set()
    if not isinstance(item, dict):
        return evidence_ids
    if item.get("evidenceId"):
        evidence_ids.add(str(item["evidenceId"]))
    evidence_ids.update(str(value) for value in _as_list(item.get("evidenceIds")))
    return evidence_ids


def score_evaluation_output(output: Any, case: dict) -> EvaluationScore:
    score = EvaluationScore()
    if not isinstance(output, dict):
        _append_violation(score, "invalid_schema")
        return score

    serialized = json.dumps(output, ensure_ascii=False)
    score.schema_success = bool(output)
    score.unsupported_conclusions = sum(
        1 for text in case.get("forbiddenConclusions", []) if text and text in serialized
    )
    if score.unsupported_conclusions:
        _append_violation(score, "forbidden_conclusion")

    required_evidence = set(case.get("requiredEvidence", []))
    cited = set(output.get("evidenceIds", []))
    for item in (
        output.get("facts", []) + output.get("inferences", [])
        + output.get("recommendations", [])
    ):
        if isinstance(item, dict):
            if item.get("evidenceId"):
                cited.add(item["evidenceId"])
            cited.update(item.get("evidenceIds", []))
    score.evidence_success = required_evidence.issubset(cited)
    if required_evidence and not score.evidence_success:
        _append_violation(score, "missing_evidence")

    source_numbers = {
        round(float(token), 6)
        for token in re.findall(
            r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?",
            json.dumps(case.get("inputSnapshot", {}), ensure_ascii=False),
        )
    }
    output_numbers = {
        round(float(token), 6)
        for token in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?", serialized)
    }
    score.numeric_success = all(
        number in source_numbers or number in {0, 1, 2, 3, 6, 12, 100}
        for number in output_numbers
    )
    if not score.numeric_success:
        _append_violation(score, "unsupported_number")

    expected = case.get("expectedRecommendations", [])
    recommendations = [
        item for item in _as_list(output.get("recommendations")) if isinstance(item, dict)
    ]
    recommendations_text = json.dumps(recommendations, ensure_ascii=False)
    score.recommendation_success = not expected or any(
        text and text in recommendations_text for text in expected
    )
    if expected and not score.recommendation_success:
        _append_violation(score, "missing_recommendation")

    expected_metric_ids = _expected_metric_ids(case)
    expected_direction = _expected_metric_direction(case)
    binding_ok = True
    direction_ok = True
    actionability_ok = True
    for recommendation in recommendations:
        rec_evidence = _evidence_ids_from(recommendation)
        rec_metric = recommendation.get("metricId") or recommendation.get("metric_id")
        if required_evidence and not rec_evidence:
            binding_ok = False
        if rec_evidence and required_evidence and not rec_evidence.issubset(required_evidence):
            binding_ok = False
        if expected_metric_ids and rec_metric and str(rec_metric) not in expected_metric_ids:
            binding_ok = False
        rec_direction = recommendation.get("direction")
        if expected_direction and rec_direction and str(rec_direction) != expected_direction:
            direction_ok = False
        if expected_direction and case.get("category") == "direction" and not rec_direction:
            direction_ok = False
        action = str(recommendation.get("action") or recommendation.get("title") or "")
        if any(phrase in action for phrase in VAGUE_RECOMMENDATIONS):
            actionability_ok = False
        if len(action.strip()) < 12:
            actionability_ok = False
        if case.get("category") in {"remediation", "specificity"}:
            if not (
                recommendation.get("ownerRole") or recommendation.get("ownerDepartment")
            ):
                actionability_ok = False
            if not (recommendation.get("period") or recommendation.get("reviewCycle")):
                actionability_ok = False
            if required_evidence and not rec_evidence:
                actionability_ok = False
    if expected and not recommendations:
        binding_ok = False
        actionability_ok = False
    score.recommendation_evidence_binding_success = binding_ok
    if not binding_ok:
        _append_violation(score, "recommendation_evidence_mismatch")
    score.metric_direction_success = direction_ok
    if not direction_ok:
        _append_violation(score, "metric_direction_error")
    score.remediation_actionability_success = actionability_ok
    if not actionability_ok:
        _append_violation(score, "vague_recommendation")

    causal_patterns = tuple(CAUSAL_PATTERNS) + (
        "导致", "造成", "证明", "唯一原因", "直接带来", "directly caused",
    )
    score.causal_safety_success = not any(
        phrase.casefold() in serialized.casefold() for phrase in causal_patterns
    ) and score.unsupported_conclusions == 0
    if not score.causal_safety_success:
        _append_violation(score, "causal_claim")

    goal = case.get("goal") or case.get("scenario") or ""
    overlap = _goal_tokens(goal) & _goal_tokens(serialized)
    score.relevance_success = not goal or bool(overlap)
    score.specificity_success = not any(
        phrase in recommendations_text for phrase in VAGUE_RECOMMENDATIONS
    )
    return score
