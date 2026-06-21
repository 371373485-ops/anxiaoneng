"""Health check and backend capability routes."""
import os
from fastapi import APIRouter

router = APIRouter()

_AI_ENABLED = os.getenv("AI_ENABLED", "false").lower() == "true"
_AI_KEY = os.getenv("ZAI_API_KEY", "")
_MODEL = os.getenv("ZHIPU_MODEL", "glm-4-flash")
_DB_URL = os.getenv("DATABASE_URL", "sqlite:///data.db")
_AUTH_MODE = os.getenv("AUTH_MODE", "development").lower()


@router.get("/api/health")
def health():
    return {
        "ok": True, "aiEnabled": _AI_ENABLED and bool(_AI_KEY),
        "model": _MODEL if _AI_ENABLED and _AI_KEY else None,
        "database": "postgresql" if _DB_URL.startswith("postgres") else "sqlite",
        "authMode": _AUTH_MODE,
    }


@router.get("/diagnosis-backend.json")
def backend_capability():
    return {"enabled": True}
