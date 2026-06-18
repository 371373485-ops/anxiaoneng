import math
import re
from datetime import date, datetime, timezone
from uuid import uuid4


TASK_STATES = ("draft", "confirmed", "in_progress", "completed", "closed")
METRIC_DIRECTIONS = ("increase", "decrease", "target", "neutral")
FEEDBACK_TYPES = {
    "helpful", "not_helpful", "numeric_error",
    "missing_evidence", "not_actionable", "other",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix):
    return f"{prefix}_{uuid4().hex}"


def next_task_state(current, requested):
    if current == "closed":
        raise ValueError("已关闭任务不可修改")
    if requested == current:
        return current
    current_index = TASK_STATES.index(current)
    if current_index + 1 >= len(TASK_STATES) or TASK_STATES[current_index + 1] != requested:
        raise ValueError(f"状态只能从 {current} 流转到 {TASK_STATES[current_index + 1]}")
    return requested


def validate_task_fields(task, status):
    if status == "draft":
        return
    required = ("action", "owner_department", "owner_name", "due_date")
    missing = [name for name in required if not task.get(name)]
    if missing:
        raise ValueError("确认任务前缺少字段：" + "、".join(missing))
    try:
        date.fromisoformat(task["due_date"])
    except ValueError as exc:
        raise ValueError("完成期限必须为 YYYY-MM-DD") from exc


def classify_review(previous, current, direction="decrease", target=None):
    empty = {
        "result": "数据不足", "change": None, "changeRatio": None,
        "improvement": None, "targetMet": None,
        "previousTargetDistance": None, "currentTargetDistance": None,
        "targetDistanceChange": None,
    }
    if previous is None or current is None:
        return empty
    if direction not in METRIC_DIRECTIONS:
        raise ValueError(f"无效指标方向：{direction}")
    previous = float(previous)
    current = float(current)
    change = current - previous
    base = max(abs(previous), 1e-9)
    previous_distance = current_distance = target_distance_change = None
    if direction == "decrease":
        improvement = -change
    elif direction == "increase":
        improvement = change
    elif direction == "target" and target is not None:
        target_value = float(target)
        previous_distance = abs(previous - target_value)
        current_distance = abs(current - target_value)
        target_distance_change = previous_distance - current_distance
        improvement = target_distance_change
    else:
        improvement = None

    if direction == "neutral":
        result = "中性监测"
    elif improvement is None:
        result = "数据不足"
    else:
        improvement_ratio = improvement / base
        if improvement_ratio >= 0.10:
            result = "明显改善"
        elif improvement_ratio > 0.02:
            result = "小幅改善"
        elif improvement_ratio < -0.02:
            result = "继续恶化"
        else:
            result = "无明显变化"

    target_met = None
    if target is not None:
        target_value = float(target)
        if direction == "decrease":
            target_met = current <= target_value
        elif direction == "increase":
            target_met = current >= target_value
        elif direction == "target":
            target_met = math.isclose(current, target_value, rel_tol=0.02, abs_tol=1e-9)
    return {
        "result": result, "change": change, "changeRatio": change / base,
        "improvement": improvement, "targetMet": target_met,
        "previousTargetDistance": previous_distance,
        "currentTargetDistance": current_distance,
        "targetDistanceChange": target_distance_change,
    }


def _walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _walk_strings(item)


def validate_interpretation(payload, evidence):
    from .validation import validate_interpretation_payload

    return validate_interpretation_payload(payload, evidence)

    # Legacy implementation is intentionally kept below for source history.
    required = {
        "summary", "facts", "inferences",
        "investigations", "recommendations", "limitations",
    }
    if not isinstance(payload, dict) or not required.issubset(payload):
        raise ValueError("AI返回结构不符合Schema")
    if not isinstance(payload["summary"], str):
        raise ValueError("summary必须为字符串")
    for field in required - {"summary"}:
        if not isinstance(payload[field], list):
            raise ValueError(f"{field}必须为数组")

    evidence_map = {item["id"]: item for item in evidence}
    allowed_numbers = set()
    for item in evidence:
        for key in ("current_value", "benchmark_value", "difference_value"):
            value = item.get(key)
            if value is not None and math.isfinite(float(value)):
                number = float(value)
                allowed_numbers.add(round(number, 6))
                allowed_numbers.add(round(number * 100, 6))

    for fact in payload["facts"]:
        if not isinstance(fact, dict) or fact.get("evidenceId") not in evidence_map:
            raise ValueError("事实缺少有效证据ID")
        source = evidence_map[fact["evidenceId"]]
        if "currentValue" in fact and fact["currentValue"] is not None:
            if abs(float(fact["currentValue"]) - float(source["current_value"])) > 1e-6:
                raise ValueError("AI事实数字与证据不一致")

    for text in _walk_strings(payload):
        for token in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?", text):
            number = round(float(token), 6)
            if number not in allowed_numbers and number not in {1, 2, 3, 6, 12}:
                raise ValueError(f"AI输出包含无证据数字：{token}")
    return payload
