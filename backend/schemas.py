from typing import Any, Literal

from pydantic import BaseModel, Field


OUTPUT_SCHEMA_VERSION = "agent-output-v1"
PLAN_SCHEMA_VERSION = "agent-plan-v1"
TOOL_SCHEMA_VERSION = "tool-result-v1"
VALIDATION_SCHEMA_VERSION = "validation-report-v1"


class ValidationDimension(BaseModel):
    passed: bool
    score: float = Field(ge=0, le=1)
    issues: list[str] = Field(default_factory=list)


class ValidationReport(BaseModel):
    passed: bool
    policy: Literal["strict", "standard"] = "strict"
    numericAccuracy: ValidationDimension
    evidenceValidity: ValidationDimension
    organizationIsolation: ValidationDimension
    metricConsistency: ValidationDimension
    relevance: ValidationDimension
    specificity: ValidationDimension
    causalSafety: ValidationDimension
    security: ValidationDimension
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    requiresHumanReview: bool = False
    schemaVersion: str = VALIDATION_SCHEMA_VERSION


class Fact(BaseModel):
    id: str
    text: str
    evidenceIds: list[str] = Field(min_length=1)
    metricId: str
    value: float | None = None
    unit: str = ""


class Inference(BaseModel):
    id: str
    text: str
    confidence: float = Field(ge=0, le=1)
    evidenceIds: list[str] = Field(min_length=1)
    limitations: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    id: str
    title: str
    action: str
    metricId: str
    direction: Literal["increase", "decrease", "target", "neutral"]
    evidenceIds: list[str] = Field(min_length=1)
    ownerRole: str
    period: str


class AgentStep(BaseModel):
    id: str
    title: str
    toolName: str
    input: dict[str, Any] = Field(default_factory=dict)
    status: Literal[
        "planned", "running", "waiting_user", "failed", "completed", "cancelled",
        "skipped", "validation_failed",
    ] = "planned"


class AgentPlan(BaseModel):
    goal: str
    steps: list[AgentStep] = Field(min_length=1, max_length=6)
    requiredTools: list[str] = Field(min_length=1)
    status: Literal[
        "planned", "running", "waiting_user", "failed", "completed", "cancelled",
        "insufficient_evidence", "validation_failed", "human_review_required",
        "degraded",
    ]
    missingInputs: list[str] = Field(default_factory=list)
    schemaVersion: str = PLAN_SCHEMA_VERSION


class ToolResult(BaseModel):
    toolName: str
    inputHash: str
    output: Any
    status: Literal["success", "failed", "cancelled"]
    latencyMs: int = Field(ge=0)
    calculationVersion: str
    source: str
    errorType: str | None = None
    schemaVersion: str = TOOL_SCHEMA_VERSION


class AgentOutput(BaseModel):
    summary: str
    facts: list[Fact] = Field(default_factory=list)
    inferences: list[Inference] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    evidenceIds: list[str] = Field(default_factory=list)
    validationReport: ValidationReport | None = None
    degraded: bool = False
    schemaVersion: str = OUTPUT_SCHEMA_VERSION
