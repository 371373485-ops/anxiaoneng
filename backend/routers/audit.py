"""Audit log and tool listing routes."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..shared import (
    Identity,
    audit,
    identity,
    db,
)
from .. import agent_runtime

router = APIRouter()


@router.get("/api/audit-logs")
def list_audit_logs(
    branch: str | None = None, period: str | None = None,
    status: str | None = None, limit: int = Query(default=100, ge=1, le=500),
    user: Identity = Depends(identity),
):
    if user.role != "admin":
        raise HTTPException(403, "仅管理员可查看审计日志")
    clauses, params = [], []
    for column, value in (("branch", branch), ("period", period), ("status", status)):
        if value:
            clauses.append(f"{column}=?")
            params.append(value)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.fetch_all(
        "SELECT * FROM audit_logs" + where + " ORDER BY created_at DESC LIMIT ?",
        (*params, limit),
    )
    for row in rows:
        row["details"] = db.load(row["details"], {})
    audit(
        user, "audit.query", "success",
        branch=branch, period=period,
        details={"filters": {"branch": branch, "period": period, "status": status, "limit": limit}},
    )
    return rows


@router.get("/api/tools")
def list_agent_tools(user: Identity = Depends(identity)):
    if user.role not in {"admin", "hq_management", "function"}:
        raise HTTPException(403, "当前角色无权查看工具注册信息")
    return {
        "version": agent_runtime.TOOL_VERSION,
        "tools": agent_runtime.tool_catalog(),
    }
