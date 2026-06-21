"""Conversation/messaging routes (SSE streaming)."""
import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..shared import (
    AI_ENABLED,
    AI_KEY,
    INTERPRETATION_PROMPT,
    MODEL,
    MessageInput,
    Identity,
    audit,
    get_diagnosis,
    get_evidence_for_diagnosis,
    identity,
    new_id,
    now_iso,
    ai_request,
    ai_error_type,
    rule_fallback,
    db,
)
from ..validation import contains_prompt_injection, validate_interpretation_payload

router = APIRouter()


@router.post("/api/conversations/{conversation_id}/messages")
async def post_message(
    conversation_id: str, body: MessageInput, request: Request,
    user: Identity = Depends(identity),
):
    diagnosis = get_diagnosis(body.diagnosisId, user)
    if contains_prompt_injection(body.question):
        raise HTTPException(422, "问题包含疑似提示注入或越权指令，已阻止发送")
    history = db.fetch_all(
        "SELECT role,content FROM messages WHERE conversation_id=? AND diagnosis_id=? ORDER BY created_at",
        (conversation_id, body.diagnosisId),
    )[-10:]
    evidence = get_evidence_for_diagnosis(body.diagnosisId)
    context = {
        "diagnosis": db.load(diagnosis["payload"], {}),
        "evidence": [{"id": e["id"], "label": e["label"], "currentValue": e["current_value"], "unit": e["unit"]} for e in evidence],
    }
    user_message_id = new_id("msg")
    db.execute(
        """INSERT INTO messages
        (id,conversation_id,diagnosis_id,org_id,branch,period,role,content,evidence_ids,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            user_message_id, conversation_id, body.diagnosisId, diagnosis["org_id"], diagnosis["branch"],
            diagnosis["period"], "user", body.question, "[]", user.user_id, now_iso(),
        ),
    )

    async def stream():
        try:
            content, usage = await asyncio.to_thread(ai_request, [
                {"role": "system", "content": INTERPRETATION_PROMPT + "\n回答追问时简洁、标注证据ID。"},
                {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                *history,
                {"role": "user", "content": body.question},
            ], True)
            structured = validate_interpretation_payload(json.loads(content), evidence)
            content = json.dumps(structured, ensure_ascii=False)
            answer_id = new_id("msg")
            db.execute(
                """INSERT INTO messages
                (id,conversation_id,diagnosis_id,org_id,branch,period,role,content,evidence_ids,created_by,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    answer_id, conversation_id, body.diagnosisId, diagnosis["org_id"], diagnosis["branch"],
                    diagnosis["period"], "assistant", content, "[]", user.user_id, now_iso(),
                ),
            )
            for offset in range(0, len(content), 48):
                if await request.is_disconnected():
                    audit(user, "conversation.message", "cancelled", branch=diagnosis["branch"], period=diagnosis["period"], target_id=answer_id)
                    return
                yield "data: " + json.dumps({"content": content[offset:offset + 48]}, ensure_ascii=False) + "\n\n"
                await asyncio.sleep(0)
            yield "data: " + json.dumps({
                "done": True, "messageId": answer_id, "usage": usage,
                "structured": structured,
            }, ensure_ascii=False) + "\n\n"
            audit(user, "conversation.message", "success", branch=diagnosis["branch"], period=diagnosis["period"], target_id=answer_id, model=MODEL)
        except HTTPException as exc:
            yield "data: " + json.dumps({"error": exc.detail}, ensure_ascii=False) + "\n\n"
        except (ValueError, json.JSONDecodeError) as exc:
            fallback = rule_fallback(context["diagnosis"])
            yield "data: " + json.dumps({
                "done": True, "degraded": True,
                "degradeReason": ai_error_type(exc), "structured": fallback,
            }, ensure_ascii=False) + "\n\n"
            audit(
                user, "conversation.message", "degraded",
                org_id=diagnosis["org_id"], branch=diagnosis["branch"],
                period=diagnosis["period"], target_id=user_message_id,
                error_type=ai_error_type(exc),
            )
        except asyncio.CancelledError:
            audit(user, "conversation.message", "cancelled", branch=diagnosis["branch"], period=diagnosis["period"], target_id=user_message_id)
            raise

    return StreamingResponse(stream(), media_type="text/event-stream")
