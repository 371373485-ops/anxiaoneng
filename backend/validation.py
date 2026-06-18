import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .schemas import AgentOutput


SENSITIVE_KEYS = {
    "api_key", "apikey", "authorization", "cookie", "password", "secret",
    "token", "zai_api_key",
}
INJECTION_PATTERNS = (
    "ignore previous", "ignore all", "忽略之前", "忽略以上", "system prompt",
    "执行sql", "drop table", "rm -rf",
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


def validate_agent_output(payload, evidence, expected_org_id=None):
    try:
        output = AgentOutput.model_validate(payload)
    except ValidationError as exc:
        raise ValueError("AI返回结构不符合AgentOutput Schema") from exc

    evidence_by_id = _evidence_map(evidence)
    allowed_numbers = _allowed_numbers(evidence)
    referenced = set(output.evidenceIds)

    for fact in output.facts:
        referenced.update(fact.evidenceIds)
        for evidence_id in fact.evidenceIds:
            source = evidence_by_id.get(evidence_id)
            if not source:
                raise ValueError(f"事实引用了无效证据ID：{evidence_id}")
            if expected_org_id and source.get("org_id") not in (None, expected_org_id):
                raise ValueError("事实引用了其他机构证据")
        if fact.value is not None and round(float(fact.value), 6) not in allowed_numbers:
            raise ValueError(f"AI事实包含无证据数字：{fact.value}")

    for item in [*output.inferences, *output.recommendations]:
        referenced.update(item.evidenceIds)
        if any(evidence_id not in evidence_by_id for evidence_id in item.evidenceIds):
            raise ValueError("推断或建议引用了无效证据ID")

    for evidence_id in referenced:
        source = evidence_by_id.get(evidence_id)
        if not source:
            raise ValueError(f"输出引用了无效证据ID：{evidence_id}")
        if expected_org_id and source.get("org_id") not in (None, expected_org_id):
            raise ValueError("输出引用了其他机构证据")

    for text in _walk_strings(payload):
        for token in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?", text):
            number = round(float(token), 6)
            if number not in allowed_numbers and number not in {0, 1, 2, 3, 6, 12, 100}:
                raise ValueError(f"AI输出包含无证据数字：{token}")
    return output.model_dump()


def validate_interpretation_payload(payload, evidence):
    required = {
        "summary", "facts", "inferences",
        "investigations", "recommendations", "limitations",
    }
    if not isinstance(payload, dict) or not required.issubset(payload):
        raise ValueError("AI返回结构不符合interpretation Schema")
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
    unsupported_conclusions: int = 0
    critical_violations: list[str] = field(default_factory=list)


def score_evaluation_output(output: Any, case: dict) -> EvaluationScore:
    score = EvaluationScore()
    if not isinstance(output, dict):
        score.critical_violations.append("invalid_schema")
        return score

    serialized = json.dumps(output, ensure_ascii=False)
    score.schema_success = bool(output)
    score.unsupported_conclusions = sum(
        1 for text in case.get("forbiddenConclusions", []) if text and text in serialized
    )
    if score.unsupported_conclusions:
        score.critical_violations.append("forbidden_conclusion")

    required_evidence = set(case.get("requiredEvidence", []))
    cited = set(output.get("evidenceIds", []))
    for item in output.get("facts", []) + output.get("inferences", []) + output.get("recommendations", []):
        if isinstance(item, dict):
            if item.get("evidenceId"):
                cited.add(item["evidenceId"])
            cited.update(item.get("evidenceIds", []))
    score.evidence_success = required_evidence.issubset(cited)
    if required_evidence and not score.evidence_success:
        score.critical_violations.append("missing_evidence")

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
        score.critical_violations.append("unsupported_number")

    expected = case.get("expectedRecommendations", [])
    recommendations_text = json.dumps(output.get("recommendations", []), ensure_ascii=False)
    score.recommendation_success = not expected or any(
        text and text in recommendations_text for text in expected
    )
    return score
