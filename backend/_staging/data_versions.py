import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Any

from . import db
from .domain import new_id, now_iso


MAX_PAYLOAD_BYTES = 20 * 1024 * 1024
SCHEMA_VERSION = "data-version-v1"
PERIOD_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class DataVersionError(ValueError):
    pass


class DataVersionConflict(DataVersionError):
    pass


class DataVersionNotFound(DataVersionError):
    pass


@dataclass(frozen=True)
class Actor:
    user_id: str
    role: str


def canonical_payload(payload: Any) -> tuple[str, bytes, str]:
    try:
        text = json.dumps(
            payload, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise DataVersionError("payload 必须是有效 JSON，且不能包含 NaN 或 Infinity") from exc
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_PAYLOAD_BYTES:
        raise DataVersionError("payload 不能超过 20MB")
    return text, encoded, hashlib.sha256(encoded).hexdigest()


def _event(tx, version_id, event_type, actor, *, from_status=None,
           to_status=None, details=None):
    # Serialize sequence allocation at the database level. PostgreSQL locks the
    # version row; SQLite acquires its transaction write lock on this no-op update.
    locked = tx.execute(
        "UPDATE data_versions SET updated_at=updated_at WHERE id=?",
        (version_id,),
    )
    if locked.rowcount != 1:
        raise DataVersionNotFound("数据版本不存在")
    next_sequence = tx.fetch_one(
        """SELECT COALESCE(MAX(event_sequence),0)+1 AS next_sequence
           FROM data_version_events WHERE data_version_id=?""",
        (version_id,),
    )["next_sequence"]
    tx.execute(
        """INSERT INTO data_version_events
        (id,data_version_id,event_sequence,event_type,from_status,to_status,
         actor_id,actor_role,details,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            new_id("dve"), version_id, next_sequence, event_type, from_status,
            to_status, actor.user_id, actor.role, db.dump(details or {}), now_iso(),
        ),
    )


def _audit(tx, actor, action, status, *, version=None, details=None,
           error_type=None):
    version = version or {}
    tx.execute(
        """INSERT INTO audit_logs
        (id,action,status,user_id,role,period,target_id,data_version,error_type,
         details,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            new_id("audit"), action, status, actor.user_id, actor.role,
            version.get("period"), version.get("id"), version.get("sha256"),
            error_type, db.dump(details or {}), now_iso(),
        ),
    )


def _serialize(row, *, include_payload=False, include_events=False):
    result = {
        "id": row["id"],
        "period": row["period"],
        "status": row["status"],
        "schemaVersion": row["schema_version"],
        "payloadSize": row["payload_size"],
        "sha256": row["sha256"],
        "validationReport": db.load(row.get("validation_report"), None),
        "createdBy": row["created_by"],
        "createdAt": row["created_at"],
        "validatedBy": row.get("validated_by"),
        "validatedAt": row.get("validated_at"),
        "publishedBy": row.get("published_by"),
        "publishedAt": row.get("published_at"),
        "archivedAt": row.get("archived_at"),
        "updatedAt": row["updated_at"],
    }
    if include_payload:
        result["payload"] = db.load(row["payload"], {})
    if include_events:
        result["events"] = [
            {
                "id": event["id"],
                "eventSequence": event["event_sequence"],
                "eventType": event["event_type"],
                "fromStatus": event["from_status"],
                "toStatus": event["to_status"],
                "actorId": event["actor_id"],
                "actorRole": event["actor_role"],
                "details": db.load(event["details"], {}),
                "createdAt": event["created_at"],
            }
            for event in db.fetch_all(
                """SELECT * FROM data_version_events
                   WHERE data_version_id=? ORDER BY event_sequence ASC""",
                (row["id"],),
            )
        ]
    return result


def create_version(period: str, payload: Any, actor: Actor,
                   schema_version: str = SCHEMA_VERSION):
    if not PERIOD_PATTERN.fullmatch(period or ""):
        raise DataVersionError("period 必须为 YYYY-MM")
    if not isinstance(payload, dict):
        raise DataVersionError("payload 必须是 JSON 对象")
    if "_plans" in payload and "actuals" not in payload:
        raise DataVersionError("暂不支持仅包含 _plans 的计划数据独立发布")
    text, encoded, digest = canonical_payload(payload)
    timestamp = now_iso()
    version_id = new_id("data")
    try:
        with db.transaction() as tx:
            existing = tx.fetch_one(
                "SELECT id FROM data_versions WHERE sha256=?", (digest,)
            )
            if existing:
                raise DataVersionConflict("相同数据哈希的数据版本已存在")
            tx.execute(
                """INSERT INTO data_versions
                (id,period,status,schema_version,payload,payload_size,sha256,
                 validation_report,created_by,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    version_id, period, "draft", schema_version, text,
                    len(encoded), digest, None, actor.user_id, timestamp, timestamp,
                ),
            )
            row = tx.fetch_one(
                "SELECT * FROM data_versions WHERE id=?", (version_id,)
            )
            _event(
                tx, version_id, "created", actor,
                to_status="draft", details={"sha256": digest, "payloadSize": len(encoded)},
            )
            _audit(
                tx, actor, "data_version.create", "success", version=row,
                details={"schemaVersion": schema_version, "payloadSize": len(encoded)},
            )
    except DataVersionConflict:
        raise
    except Exception as exc:
        if "sha256" in str(exc).lower() or "unique" in str(exc).lower():
            raise DataVersionConflict("相同数据哈希的数据版本已存在") from exc
        raise
    return get_version(version_id)


def _snapshot(payload, period):
    if "actuals" in payload:
        actuals = payload.get("actuals")
        if not isinstance(actuals, dict):
            return None, ["payload.actuals 必须是对象"]
        if period not in actuals:
            return None, [f"payload.actuals 缺少周期 {period}"]
        return actuals[period], []
    return payload, []


def validate_payload(payload: Any, period: str):
    errors = []
    warnings = []
    if not isinstance(payload, dict):
        return {
            "passed": False, "errors": ["payload 必须是对象"],
            "warnings": [], "branchCount": 0,
        }
    snapshot, snapshot_errors = _snapshot(payload, period)
    errors.extend(snapshot_errors)
    if snapshot is None:
        return {
            "passed": False, "errors": errors,
            "warnings": warnings, "branchCount": 0,
        }
    if not isinstance(snapshot, dict):
        errors.append("周期数据必须是对象")
        snapshot = {}
    branches = snapshot.get("branches")
    if not isinstance(branches, list) or not branches:
        errors.append("周期数据 branches 必须是非空数组")
        branches = []
    national = snapshot.get("national")
    if not isinstance(national, dict):
        errors.append("周期数据 national 必须是对象")
    names = set()
    for index, branch in enumerate(branches):
        if not isinstance(branch, dict):
            errors.append(f"branches[{index}] 必须是对象")
            continue
        name = branch.get("n")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"branches[{index}].n 不能为空")
        elif name.strip() in names:
            errors.append(f"分公司名称重复：{name.strip()}")
        else:
            names.add(name.strip())
        data = branch.get("d")
        if not isinstance(data, dict):
            errors.append(f"branches[{index}].d 必须是对象")
            continue
        for key, value in data.items():
            if not isinstance(key, str) or not key:
                errors.append(f"branches[{index}].d 包含无效指标名")
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                errors.append(f"branches[{index}].d.{key} 必须是有限数值或 null")
    if isinstance(national, dict):
        for key, value in national.items():
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                errors.append(f"national.{key} 必须是有限数值或 null")
    if not snapshot.get("regions"):
        warnings.append("周期数据未包含 regions，将无法直接读取责任区汇总")
    return {
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "branchCount": len(branches),
        "period": period,
    }


def validate_version(version_id: str, actor: Actor):
    with db.transaction() as tx:
        row = tx.fetch_one("SELECT * FROM data_versions WHERE id=?", (version_id,))
        if not row:
            raise DataVersionNotFound("数据版本不存在")
        if row["status"] != "draft":
            raise DataVersionConflict("仅 draft 状态可以校验")
        report = validate_payload(db.load(row["payload"], {}), row["period"])
        timestamp = now_iso()
        if not report["passed"]:
            _event(
                tx, version_id, "validation_failed", actor,
                from_status="draft", to_status="draft", details=report,
            )
            _audit(
                tx, actor, "data_version.validate", "failed", version=row,
                details=report, error_type="invalid_payload",
            )
            return None, report
        tx.execute(
            """UPDATE data_versions
               SET status='validated',validation_report=?,validated_by=?,
                   validated_at=?,updated_at=?
               WHERE id=? AND status='draft'""",
            (db.dump(report), actor.user_id, timestamp, timestamp, version_id),
        )
        updated = tx.fetch_one(
            "SELECT * FROM data_versions WHERE id=?", (version_id,)
        )
        _event(
            tx, version_id, "validated", actor,
            from_status="draft", to_status="validated", details=report,
        )
        _audit(
            tx, actor, "data_version.validate", "success",
            version=updated, details=report,
        )
    return get_version(version_id), report


def _publish_target(tx, version_id, actor, timestamp):
    tx.execute(
        """UPDATE data_versions
           SET status='published',published_by=?,published_at=?,updated_at=?
           WHERE id=? AND status='validated'""",
        (actor.user_id, timestamp, timestamp, version_id),
    )


def publish_version(version_id: str, actor: Actor):
    row = None
    try:
        with db.transaction() as tx:
            row = tx.fetch_one(
                "SELECT * FROM data_versions WHERE id=?", (version_id,)
            )
            if not row:
                raise DataVersionNotFound("数据版本不存在")
            if row["status"] != "validated":
                raise DataVersionConflict("仅 validated 状态可以发布")
            timestamp = now_iso()
            current = tx.fetch_one(
                """SELECT * FROM data_versions
                   WHERE period=? AND status='published' AND id<>?""",
                (row["period"], version_id),
            )
            if current:
                tx.execute(
                    """UPDATE data_versions
                       SET status='archived',archived_at=?,updated_at=?
                       WHERE id=? AND status='published'""",
                    (timestamp, timestamp, current["id"]),
                )
                _event(
                    tx, current["id"], "archived", actor,
                    from_status="published", to_status="archived",
                    details={"replacementId": version_id},
                )
            _publish_target(tx, version_id, actor, timestamp)
            updated = tx.fetch_one(
                "SELECT * FROM data_versions WHERE id=?", (version_id,)
            )
            _event(
                tx, version_id, "published", actor,
                from_status="validated", to_status="published",
                details={"archivedVersionId": current["id"] if current else None},
            )
            _audit(
                tx, actor, "data_version.publish", "success",
                version=updated,
                details={"archivedVersionId": current["id"] if current else None},
            )
    except (DataVersionNotFound, DataVersionConflict):
        raise
    except Exception as exc:
        if row:
            with db.transaction() as tx:
                _audit(
                    tx, actor, "data_version.publish", "failed",
                    version=row, error_type="publish_failed",
                    details={"error": type(exc).__name__},
                )
        raise
    return get_version(version_id)


def list_versions(period=None, status=None):
    clauses = []
    params = []
    if period:
        clauses.append("period=?")
        params.append(period)
    if status:
        if status not in {"draft", "validated", "published", "archived"}:
            raise DataVersionError("无效状态")
        clauses.append("status=?")
        params.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return [
        _serialize(row)
        for row in db.fetch_all(
            "SELECT * FROM data_versions" + where + " ORDER BY created_at DESC,id",
            tuple(params),
        )
    ]


def get_version(version_id: str):
    row = db.fetch_one("SELECT * FROM data_versions WHERE id=?", (version_id,))
    if not row:
        raise DataVersionNotFound("数据版本不存在")
    return _serialize(row, include_payload=True, include_events=True)
