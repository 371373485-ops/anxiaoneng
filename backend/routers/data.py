"""Organization and backup data routes."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..shared import (
    Identity,
    identity,
    db,
    now_iso,
)

router = APIRouter()


@router.get("/api/organizations")
def list_organizations(
    org_type: str | None = Query(default=None, alias="type"),
    active: bool = True,
    user: Identity = Depends(identity),
):
    clauses, params = ["active=?"], [1 if active else 0]
    if org_type:
        clauses.append("org_type=?")
        params.append(org_type)
    rows = db.fetch_all(
        "SELECT * FROM organizations WHERE " + " AND ".join(clauses) + " ORDER BY name",
        tuple(params),
    )
    if user.role not in {"admin", "hq_management", "function"} and "*" not in user.branches:
        allowed = set(user.branches)
        rows = [
            row for row in rows
            if row["org_id"] in allowed or row["name"] in allowed
        ]
    return [
        {
            "orgId": row["org_id"], "orgCode": row["org_code"],
            "orgType": row["org_type"], "name": row["name"],
            "parentOrgId": row["parent_org_id"], "active": bool(row["active"]),
        }
        for row in rows
    ]


@router.post("/save-backup")
async def save_backup(request: Request, user: Identity = Depends(identity)):
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(400, "备份必须为JSON对象") from exc
    if not isinstance(payload, dict) or not (
        isinstance(payload.get("actuals"), dict) or isinstance(payload.get("_plans"), dict)
    ):
        raise HTTPException(422, "备份缺少 actuals 或 _plans")
    serialized = db.dump(payload)
    if len(serialized.encode("utf-8")) > 10 * 1024 * 1024:
        raise HTTPException(413, "备份超过10MB")
    timestamp = now_iso()
    db.execute(
        """INSERT INTO data_backups (id,payload,created_by,created_at)
        VALUES (?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,
        created_by=excluded.created_by,created_at=excluded.created_at""",
        ("default", serialized, user.user_id, timestamp),
    )
    return {"ok": True, "size": len(serialized.encode("utf-8"))}


@router.get("/_data_backup.json")
def read_backup(user: Identity = Depends(identity)):
    row = db.fetch_one("SELECT payload FROM data_backups WHERE id=?", ("default",))
    return db.load(row["payload"], {}) if row else {"actuals": {}, "_plans": {}}
