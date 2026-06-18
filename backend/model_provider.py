import json
from typing import Protocol

from .schemas import AgentOutput
from .validation import redact_sensitive


class ModelProvider(Protocol):
    name: str

    def generate_structured(self, *, system_prompt, context, schema): ...


def strict_agent_output_schema():
    return AgentOutput.model_json_schema()


def build_grounded_model_request(goal, plan, tool_results, evidence):
    return {
        "goal": goal,
        "plan": redact_sensitive(plan),
        "toolResults": redact_sensitive(tool_results),
        "evidence": redact_sensitive(evidence),
        "rules": [
            "只能引用工具结果和证据中的事实与数字",
            "证据不足时必须声明不足，不得猜测",
            "事实、推断、建议必须严格分离",
            "不得宣称未经证实的因果关系",
        ],
        "responseSchema": strict_agent_output_schema(),
    }


def parse_strict_output(raw):
    payload = json.loads(raw) if isinstance(raw, str) else raw
    return AgentOutput.model_validate(payload).model_dump()
