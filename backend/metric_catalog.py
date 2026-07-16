"""Shared metric catalog used by backend review and validation paths.

This is the backend mirror of the first-phase frontend metric catalog.  Keep the
surface intentionally small: backend code needs deterministic direction,
benchmark, target and plan semantics, not UI-only display configuration.
"""

METRIC_CATALOG_VERSION = "metric-catalog-v1"


def _metric(**config):
    result = {
        "targetType": "none",
        "targetValue": None,
        "planField": None,
        "planPeriod": None,
        "planValueScope": None,
        "remediationApplicable": True,
        "reviewCycle": "monthly",
        "validLevels": ["branch", "region", "national"],
        "metadataVersion": METRIC_CATALOG_VERSION,
    }
    result.update(config)
    return result


def _annual_plan(**config):
    result = {
        "targetType": "annual_plan",
        "planPeriod": "year",
        "planValueScope": "annual",
    }
    result.update(config)
    return _metric(**result)


METRIC_CATALOG = {
    "保费实际合计": _annual_plan(
        metricId="M_PREMIUM_TOTAL",
        key="保费实际合计",
        label="保费实际合计",
        category="amount",
        unit="万元",
        direction="increase",
        benchmarkStrategy="plan",
        planField="保费年度计划",
    ),
    "经营利润": _annual_plan(
        metricId="M_OPERATING_PROFIT",
        key="经营利润",
        label="经营利润",
        category="amount",
        unit="万元",
        direction="increase",
        benchmarkStrategy="plan",
        planField="经营利润年度计划",
    ),
    "当月经营利润": _metric(
        metricId="M_MONTHLY_OPERATING_PROFIT",
        key="当月经营利润",
        label="当月经营利润",
        category="amount",
        unit="万元",
        direction="increase",
        benchmarkStrategy="prior",
    ),
    "综合成本率实际（整体利润口径）": _metric(
        metricId="M_COMBINED_RATIO",
        key="综合成本率实际（整体利润口径）",
        label="综合成本率实际（整体利润口径）",
        category="ratio",
        unit="%",
        direction="decrease",
        benchmarkStrategy="weightedOverall",
        targetType="plan",
        planField="综合成本率计划（整体利润口径）",
    ),
    "已赚赔付率实际": _metric(
        metricId="M_EARNED_LOSS_RATIO",
        key="已赚赔付率实际",
        label="已赚赔付率实际",
        category="ratio",
        unit="%",
        direction="decrease",
        benchmarkStrategy="weightedOverall",
    ),
    "已赚费用率实际": _metric(
        metricId="M_EARNED_EXPENSE_RATIO",
        key="已赚费用率实际",
        label="已赚费用率实际",
        category="ratio",
        unit="%",
        direction="decrease",
        benchmarkStrategy="weightedOverall",
    ),
    "时间进度计划达成率": _annual_plan(
        metricId="M_PREMIUM_TIME_PROGRESS_ATTAINMENT",
        key="时间进度计划达成率",
        label="时间进度计划达成率",
        category="attainment",
        unit="%",
        direction="target",
        benchmarkStrategy="target",
        targetType="time_progress",
        targetValue=1.0,
        planField="保费年度计划",
    ),
    "时间进度达成率": _annual_plan(
        metricId="M_PROFIT_TIME_PROGRESS_ATTAINMENT",
        key="时间进度达成率",
        label="时间进度达成率",
        category="attainment",
        unit="%",
        direction="target",
        benchmarkStrategy="target",
        targetType="time_progress",
        targetValue=1.0,
        planField="经营利润年度计划",
    ),
    "保费年度计划": _annual_plan(
        metricId="M_PREMIUM_ANNUAL_PLAN",
        key="保费年度计划",
        label="保费年度计划",
        category="budget",
        unit="万元",
        direction="neutral",
        benchmarkStrategy="none",
        remediationApplicable=False,
    ),
    "经营利润年度计划": _annual_plan(
        metricId="M_PROFIT_ANNUAL_PLAN",
        key="经营利润年度计划",
        label="经营利润年度计划",
        category="budget",
        unit="万元",
        direction="neutral",
        benchmarkStrategy="none",
        remediationApplicable=False,
    ),
}

for prefix in ("前台", "后台", "整体"):
    for key in (
        f"{prefix}人力成本预算执行率",
        f"{prefix}人力成本保费率计划执行率",
        f"{prefix}人员计划执行率",
    ):
        METRIC_CATALOG[key] = _metric(
            metricId="M_" + key,
            key=key,
            label=key,
            category="attainment",
            unit="%",
            direction="target",
            benchmarkStrategy="target",
            targetType="fixed",
            targetValue=1.0,
        )
    METRIC_CATALOG[f"{prefix}人力成本保费率实际"] = _metric(
        metricId="M_" + f"{prefix}人力成本保费率实际",
        key=f"{prefix}人力成本保费率实际",
        label=f"{prefix}人力成本保费率实际",
        category="ratio",
        unit="%",
        direction="decrease",
        benchmarkStrategy="weightedOverall",
    )
    for key, plan in (
        (f"{prefix}人均产能实际", f"{prefix}人均产能计划"),
        (f"{prefix}人均利润实际", f"{prefix}人均利润计划"),
    ):
        METRIC_CATALOG[key] = _annual_plan(
            metricId="M_" + key,
            key=key,
            label=key,
            category="productivity",
            unit="万元/人",
            direction="increase",
            benchmarkStrategy="median",
            planField=plan,
        )
    for key, plan in (
        (f"{prefix}人员实际", f"{prefix}人员计划"),
        (f"{prefix}平均人数", f"{prefix}人员计划"),
    ):
        METRIC_CATALOG[key] = _metric(
            metricId="M_" + key,
            key=key,
            label=key,
            category="count",
            unit="人",
            direction="neutral",
            benchmarkStrategy="plan",
            targetType="plan",
            planField=plan,
            remediationApplicable=False,
        )

_BY_ID = {item["metricId"]: item for item in METRIC_CATALOG.values()}


def get_metric_catalog_entry(metric_id=None, metric_key=None):
    """Return catalog metadata by metric id first, then metric key."""
    if metric_id and metric_id in _BY_ID:
        return _BY_ID[metric_id]
    if metric_key and metric_key in METRIC_CATALOG:
        return METRIC_CATALOG[metric_key]
    return None
