import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db

ROOT = Path(__file__).resolve().parents[1]
AUTH_MODE = os.getenv("AUTH_MODE", "development").lower()
AUTH_TOKEN = os.getenv("API_AUTH_TOKEN", "")


@asynccontextmanager
async def lifespan(_app):
    if os.getenv("APP_ENV", "development").lower() == "production":
        if AUTH_MODE not in {"proxy", "token"}:
            raise RuntimeError("生产环境 AUTH_MODE 必须�?proxy �?token")
        if AUTH_MODE == "token" and not AUTH_TOKEN:
            raise RuntimeError("token 鉴权模式必须配置 API_AUTH_TOKEN")
    db.init_db()
    yield


app = FastAPI(
    title="智能经营诊断与整改闭环API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.getenv(
        "ALLOWED_ORIGINS", "http://127.0.0.1:8921,http://localhost:8921"
    ).split(",") if item.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type", "Authorization", "X-User-Id", "X-Role", "X-Branches",
        "X-Authenticated-User", "X-Authenticated-Role", "X-Authenticated-Branches",
    ],
)

# Register routers
from .routers.health import router as health_router
from .routers.data import router as data_router
from .routers.diagnosis import router as diagnosis_router
from .routers.conversation import router as conversation_router
from .routers.evaluation import router as evaluation_router
from .routers.remediation import router as remediation_router
from .routers.audit import router as audit_router
from .routers.agent import router as agent_router
from .routers.ai import router as ai_router

app.include_router(ai_router)
app.include_router(health_router)
app.include_router(data_router)
app.include_router(diagnosis_router)
app.include_router(conversation_router)
app.include_router(evaluation_router)
app.include_router(remediation_router)
app.include_router(audit_router)
app.include_router(agent_router)

if os.getenv("SERVE_FRONTEND", "true").lower() == "true":
    app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
