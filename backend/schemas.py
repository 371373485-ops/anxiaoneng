from typing import Any, Literal

from pydantic import BaseModel, Field


OUTPUT_SCHEMA_VERSION = "agent-output-v1"
PLAN_SCHEMA_VERSION = "agent-plan-v1"
TOOL_SCHEMA_VERSION = "tool-result-v1"


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
        "planned", "running", "waiting_user", "failed", "completed", "cancelled", "skipped"
    ] = "planned"


class AgentPlan(BaseModel):
    goal: str
    steps: list[AgentStep] = Field(min_length=1, max_length=6)
    requiredTools: list[str] = Field(min_length=1)
    status: Literal[
        "planned", "running", "waiting_user", "failed", "completed", "cancelled"
    ]
    missingInputs: list[str] = Field(default_factory=list)
    schemaVersion: str = PLAN_SCHEMA_VERSION


class ToolResult(BaseModel):
    toolName: str
    inputHash: str
    output: Any
    status: Literal["success", "failed", "cancelled"]
    latencyMs: int = Field(ge=0)
    errorType: str | None = None
    schemaVersion: str = TOOL_SCHEMA_VERSION


class AgentOutput(BaseModel):
    summary: str
    facts: list[Fact] = Field(default_factory=list)
    inferences: list[Inference] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    evidenceIds: list[str] = Field(default_factory=list)
    degraded: bool = False
    schemaVersion: str = OUTPUT_SCHEMA_VERSION
