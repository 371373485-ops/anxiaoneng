import copy
import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from . import db
from .domain import new_id, now_iso


TOKEN_BYTES = 32
VALID_MODES = {"latest", "fixed"}
SHARED_ROOT_FIELDS = {
    "actuals", "_plans", "currentMonth", "currentPlanKey",
    "_importTimes", "_alertRules", "__rulesConfigured",
}


class ShareLinkError(ValueError):
    pass


class ShareLinkNotFound(ShareLinkError):
    pass


class ShareLinkAccessDenied(ShareLinkError):
    pass


@dataclass(frozen=True)
class Actor:
    user_id: str
    role: str


def _token_pair():
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, hashlib.sha256(token.encode("utf-8")).hexdigest()


def _parse_expiry(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError as exc:
            raise ShareLinkError("expiresAt 必须是 ISO 8601 时间") from exc
    if parsed.tzinfo is None:
        raise ShareLinkError("expiresAt 必须包含时区")
    return parsed.astimezone(timezone.utc).isoformat()


def _normalize_org_ids(org_ids):
    if not isinstance(org_ids, list) or not org_ids:
        raise ShareLinkError("allowedOrgIds 必须是非空数组")
    clean = []
    for org_id in org_ids:
        if not isinstance(org_id, str) or not org_id.strip():
            raise ShareLinkError("allowedOrgIds 包含无效机构")
        value = org_id.strip()
        if value not in clean:
            clean.append(value)
    placeholders = ",".join("?" for _ in clean)
    rows = db.fetch_all(
        f"SELECT org_id FROM organizations WHERE org_id IN ({placeholders})",
        tuple(clean),
    )
    found = {row["org_id"] for row in rows}
    missing = [org_id for org_id in clean if org_id not in found]
    if missing:
        raise ShareLinkError("allowedOrgIds 包含不存在的机构：" + ",".join(missing))
    return clean


def _published_version(version_id):
    row = db.fetch_one(
        "SELECT * FROM data_versions WHERE id=? AND status='published'",
        (version_id,),
    )
    if not row:
        raise ShareLinkError("fixedDataVersionId 必须指向 published 版本")
    return row


def _audit(tx, actor, action, status, *, link_id=None, details=None,
           error_type=None):
    tx.execute(
        """INSERT INTO audit_logs
        (id,action,status,user_id,role,target_id,error_type,details,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            new_id("audit"), action, status, actor.user_id, actor.role,
            link_id, error_type, db.dump(details or {}), now_iso(),
        ),
    )


def _serialize(row):
    return {
        "id": row["id"],
        "mode": row["mode"],
        "fixedDataVersionId": row["fixed_data_version_id"],
        "enabled": bool(row["enabled"]),
        "expiresAt": row["expires_at"],
        "allowedOrgIds": db.load(row["allowed_org_ids"], []),
        "allowExport": bool(row["allow_export"]),
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "updatedBy": row["updated_by"],
        "updatedAt": row["updated_at"],
        "rotatedAt": row["rotated_at"],
    }


def create_link(*, mode, fixed_data_version_id, enabled, expires_at,
                allowed_org_ids, allow_export, actor):
    if mode not in VALID_MODES:
        raise ShareLinkError("mode 仅支持 latest 或 fixed")
    if mode == "fixed":
        if not fixed_data_version_id:
            raise ShareLinkError("fixed 模式必须提供 fixedDataVersionId")
        _published_version(fixed_data_version_id)
    elif fixed_data_version_id:
        raise ShareLinkError("latest 模式不能提供 fixedDataVersionId")
    org_ids = _normalize_org_ids(allowed_org_ids)
    expiry = _parse_expiry(expires_at)
    token, token_hash = _token_pair()
    link_id = new_id("share")
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """INSERT INTO share_links
            (id,mode,fixed_data_version_id,token_hash,enabled,expires_at,
             allowed_org_ids,allow_export,created_by,created_at,updated_by,
             updated_at,rotated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                link_id, mode, fixed_data_version_id, token_hash,
                1 if enabled else 0, expiry, db.dump(org_ids),
                1 if allow_export else 0, actor.user_id, timestamp,
                actor.user_id, timestamp, None,
            ),
        )
        _audit(
            tx, actor, "share_link.create", "success", link_id=link_id,
            details={"mode": mode, "allowedOrgIds": org_ids},
        )
    result = get_link(link_id)
    result["token"] = token
    return result


def list_links():
    return [
        _serialize(row)
        for row in db.fetch_all(
            "SELECT * FROM share_links ORDER BY created_at DESC,id"
        )
    ]


def get_link(link_id):
    row = db.fetch_one("SELECT * FROM share_links WHERE id=?", (link_id,))
    if not row:
        raise ShareLinkNotFound("分享链接不存在")
    return _serialize(row)


def update_link(link_id, changes, actor):
    row = db.fetch_one("SELECT * FROM share_links WHERE id=?", (link_id,))
    if not row:
        raise ShareLinkNotFound("分享链接不存在")
    allowed = {"enabled", "expiresAt", "allowedOrgIds", "allowExport"}
    unknown = set(changes) - allowed
    if unknown:
        raise ShareLinkError("不支持修改字段：" + ",".join(sorted(unknown)))
    values = {
        "enabled": bool(row["enabled"]),
        "expiresAt": row["expires_at"],
        "allowedOrgIds": db.load(row["allowed_org_ids"], []),
        "allowExport": bool(row["allow_export"]),
    }
    values.update(changes)
    org_ids = _normalize_org_ids(values["allowedOrgIds"])
    expiry = _parse_expiry(values["expiresAt"])
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """UPDATE share_links
               SET enabled=?,expires_at=?,allowed_org_ids=?,allow_export=?,
                   updated_by=?,updated_at=? WHERE id=?""",
            (
                1 if values["enabled"] else 0, expiry, db.dump(org_ids),
                1 if values["allowExport"] else 0, actor.user_id, timestamp,
                link_id,
            ),
        )
        _audit(
            tx, actor, "share_link.update", "success", link_id=link_id,
            details={"changedFields": sorted(changes)},
        )
    return get_link(link_id)


def rotate_link(link_id, actor):
    if not db.fetch_one("SELECT id FROM share_links WHERE id=?", (link_id,)):
        raise ShareLinkNotFound("分享链接不存在")
    token, token_hash = _token_pair()
    timestamp = now_iso()
    with db.transaction() as tx:
        tx.execute(
            """UPDATE share_links SET token_hash=?,rotated_at=?,
               updated_by=?,updated_at=? WHERE id=?""",
            (token_hash, timestamp, actor.user_id, timestamp, link_id),
        )
        _audit(
            tx, actor, "share_link.rotate", "success", link_id=link_id,
            details={"rotated": True},
        )
    result = get_link(link_id)
    result["token"] = token
    return result


def _is_expired(expires_at):
    if not expires_at:
        return False
    return datetime.fromisoformat(expires_at).astimezone(timezone.utc) <= datetime.now(
        timezone.utc
    )


def _resolve_version(link):
    if link["mode"] == "fixed":
        return db.fetch_one(
            """SELECT * FROM data_versions
               WHERE id=? AND status IN ('published','archived')""",
            (link["fixed_data_version_id"],),
        )
    return db.fetch_one(
        """SELECT * FROM data_versions WHERE status='published'
           ORDER BY period DESC,published_at DESC,id DESC LIMIT 1"""
    )


def _organization_names(org_ids):
    placeholders = ",".join("?" for _ in org_ids)
    rows = db.fetch_all(
        f"SELECT org_id,name FROM organizations WHERE org_id IN ({placeholders})",
        tuple(org_ids),
    )
    return {row["name"] for row in rows}


def _filter_branches(branches, allowed_org_ids, names):
    if not isinstance(branches, list):
        raise ShareLinkAccessDenied("已发布数据缺少 branches")
    filtered = []
    for branch in branches:
        if not isinstance(branch, dict):
            continue
        branch_org_id = branch.get("orgId") or branch.get("org_id")
        if branch_org_id in allowed_org_ids or branch.get("n") in names:
            filtered.append(copy.deepcopy(branch))
    return filtered


def _filter_snapshot(snapshot, allowed_org_ids, names):
    if not isinstance(snapshot, dict):
        raise ShareLinkAccessDenied("已发布数据结构无效")
    safe = {
        key: copy.deepcopy(value)
        for key, value in snapshot.items()
        if key not in {"branches", "regions", "national"}
    }
    safe["branches"] = _filter_branches(
        snapshot.get("branches"), allowed_org_ids, names
    )
    return safe


def _safe_import_times(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for category in ("actuals", "plans"):
        entries = value.get(category)
        if isinstance(entries, dict):
            result[category] = {
                str(key): timestamp
                for key, timestamp in entries.items()
                if isinstance(timestamp, str)
            }
    return result


def filter_payload(payload, period, allowed_org_ids):
    names = _organization_names(allowed_org_ids)
    source = copy.deepcopy(payload)
    if not isinstance(source, dict):
        raise ShareLinkAccessDenied("已发布数据结构无效")
    if "actuals" not in source:
        actuals = {period: source}
    else:
        actuals = source.get("actuals")
    if not isinstance(actuals, dict):
        raise ShareLinkAccessDenied("已发布数据 actuals 结构无效")

    safe = {"actuals": {
        period_key: _filter_snapshot(snapshot, allowed_org_ids, names)
        for period_key, snapshot in actuals.items()
    }}

    if "_plans" in source:
        plans = source.get("_plans")
        if not isinstance(plans, dict):
            raise ShareLinkAccessDenied("已发布数据 _plans 结构无效")
        safe["_plans"] = {
            plan_key: _filter_snapshot(plan, allowed_org_ids, names)
            for plan_key, plan in plans.items()
        }
    for key in ("currentMonth", "currentPlanKey", "_alertRules", "__rulesConfigured"):
        if key in source and key in SHARED_ROOT_FIELDS:
            safe[key] = copy.deepcopy(source[key])
    if "_importTimes" in source:
        safe["_importTimes"] = _safe_import_times(source["_importTimes"])
    return safe


def access_shared_data(token):
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    link = db.fetch_one(
        "SELECT * FROM share_links WHERE token_hash=?", (token_hash,)
    )
    public_actor = Actor(user_id="public-share", role="public")
    if not link:
        with db.transaction() as tx:
            _audit(
                tx, public_actor, "share_link.access", "denied",
                error_type="invalid_token", details={"reason": "invalid_token"},
            )
        raise ShareLinkAccessDenied("分享链接无效")
    if not link["enabled"]:
        reason = "disabled"
    elif _is_expired(link["expires_at"]):
        reason = "expired"
    else:
        reason = None
    if reason:
        with db.transaction() as tx:
            _audit(
                tx, public_actor, "share_link.access", "denied",
                link_id=link["id"], error_type=reason, details={"reason": reason},
            )
        raise ShareLinkAccessDenied("分享链接不可用")
    version = _resolve_version(link)
    if not version:
        with db.transaction() as tx:
            _audit(
                tx, public_actor, "share_link.access", "denied",
                link_id=link["id"], error_type="no_published_version",
                details={"reason": "no_published_version"},
            )
        raise ShareLinkAccessDenied("没有可分享的已发布数据")
    allowed_org_ids = db.load(link["allowed_org_ids"], [])
    payload = filter_payload(
        db.load(version["payload"], {}), version["period"], allowed_org_ids
    )
    with db.transaction() as tx:
        _audit(
            tx, public_actor, "share_link.access", "success",
            link_id=link["id"],
            details={
                "dataVersionId": version["id"],
                "allowedOrgCount": len(allowed_org_ids),
            },
        )
    return {
        "shareLinkId": link["id"],
        "mode": link["mode"],
        "dataVersion": {
            "id": version["id"],
            "period": version["period"],
            "schemaVersion": version["schema_version"],
            "publishedAt": version["published_at"],
        },
        "allowedOrgIds": allowed_org_ids,
        "allowExport": bool(link["allow_export"]),
        "payload": payload,
        "aiEnabled": False,
    }
