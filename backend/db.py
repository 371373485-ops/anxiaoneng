import json
import hashlib
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from functools import wraps
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'diagnosis.db'}")
_LOCK = threading.RLock()
_TX = threading.local()


def _is_postgres():
    return DATABASE_URL.startswith(("postgres://", "postgresql://"))


def _connect():
    if _is_postgres():
        try:
            import psycopg
        except ImportError as exc:
            raise RuntimeError("PostgreSQL requires psycopg[binary]") from exc
        return psycopg.connect(DATABASE_URL)
    path = DATABASE_URL.replace("sqlite:///", "", 1)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _sql(statement):
    return statement.replace("?", "%s") if _is_postgres() else statement


@contextmanager
def connection():
    ambient = getattr(_TX, "conn", None)
    if ambient is not None:
        yield ambient
        return
    with _LOCK:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def atomic(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        if getattr(_TX, "conn", None) is not None:
            return func(*args, **kwargs)
        with _LOCK:
            conn = _connect()
            _TX.conn = conn
            try:
                result = func(*args, **kwargs)
                conn.commit()
                return result
            except Exception:
                conn.rollback()
                raise
            finally:
                _TX.conn = None
                conn.close()
    return wrapped


class Transaction:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, statement, params=()):
        cur = self.conn.cursor()
        cur.execute(_sql(statement), params)
        return cur

    def fetch_one(self, statement, params=()):
        cur = self.execute(statement, params)
        row = cur.fetchone()
        if row is None:
            return None
        if hasattr(row, "keys"):
            return {key: row[key] for key in row.keys()}
        return dict(zip([getattr(item, "name", item[0]) for item in cur.description], row))

    def fetch_all(self, statement, params=()):
        cur = self.execute(statement, params)
        rows = cur.fetchall()
        columns = [getattr(item, "name", item[0]) for item in cur.description]
        return [
            {key: row[key] for key in row.keys()}
            if hasattr(row, "keys")
            else dict(zip(columns, row))
            for row in rows
        ]


@contextmanager
def transaction():
    with connection() as conn:
        yield Transaction(conn)


def execute(statement, params=()):
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_sql(statement), params)
        return cur.rowcount


def fetch_one(statement, params=()):
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_sql(statement), params)
        row = cur.fetchone()
        if row is None:
            return None
        if hasattr(row, "keys"):
            return {key: row[key] for key in row.keys()}
        return dict(zip([item.name for item in cur.description], row))


def fetch_all(statement, params=()):
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_sql(statement), params)
        rows = cur.fetchall()
        columns = [getattr(item, "name", item[0]) for item in cur.description]
        return [
            {key: row[key] for key in row.keys()}
            if hasattr(row, "keys")
            else dict(zip(columns, row))
            for row in rows
        ]


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def load(value, default=None):
    if value in (None, ""):
        return default
    return json.loads(value)


def normalize_org_name(name):
    return re.sub(r"[\s\u3000]+", "", str(name or "")).casefold()


def stable_org_id(name):
    normalized = normalize_org_name(name)
    return "BR_" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16].upper()


SCHEMA = [
    """CREATE TABLE IF NOT EXISTS diagnoses (
        id TEXT PRIMARY KEY, org_id TEXT, branch TEXT NOT NULL, period TEXT NOT NULL,
        schema_version TEXT, data_version TEXT NOT NULL, rule_version TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        risk_level TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL,
        UNIQUE(branch, period, data_version, rule_version)
    )""",
    """CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY, diagnosis_id TEXT NOT NULL, org_id TEXT, branch TEXT NOT NULL,
        period TEXT NOT NULL, metric TEXT NOT NULL, label TEXT NOT NULL,
        metric_id TEXT, direction TEXT, benchmark_type TEXT, benchmark_label TEXT,
        calculation_version TEXT,
        current_value REAL, benchmark_value REAL, difference_value REAL,
        unit TEXT, source TEXT NOT NULL, rule_id TEXT, payload TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS interpretations (
        id TEXT PRIMARY KEY, diagnosis_id TEXT NOT NULL, org_id TEXT, branch TEXT NOT NULL,
        period TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
        schema_version TEXT NOT NULL, payload TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, diagnosis_id TEXT NOT NULL,
        org_id TEXT, branch TEXT NOT NULL, period TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, evidence_ids TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY, target_id TEXT NOT NULL, target_type TEXT NOT NULL,
        org_id TEXT, branch TEXT NOT NULL, period TEXT NOT NULL, feedback_type TEXT NOT NULL,
        comment TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS remediation_tasks (
        id TEXT PRIMARY KEY, diagnosis_id TEXT NOT NULL, recommendation_index INTEGER,
        source_recommendation_id TEXT, org_id TEXT, metric_id TEXT,
        branch TEXT NOT NULL, period TEXT NOT NULL, title TEXT NOT NULL,
        risk_metrics TEXT NOT NULL, description TEXT NOT NULL, action TEXT NOT NULL,
        owner_department TEXT, owner_name TEXT, due_date TEXT,
        current_value REAL, target_value REAL, metric TEXT, direction TEXT,
        status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS remediation_reviews (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, diagnosis_id TEXT NOT NULL,
        org_id TEXT, branch TEXT NOT NULL, period TEXT NOT NULL, previous_value REAL,
        current_value REAL, change_value REAL, change_ratio REAL, result TEXT NOT NULL,
        target_met INTEGER, previous_target_distance REAL, current_target_distance REAL,
        target_distance_change REAL, benchmark_change REAL, rank_change REAL,
        limitations TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS metric_metadata (
        metric_id TEXT PRIMARY KEY, metric_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        unit TEXT NOT NULL, category TEXT, direction TEXT NOT NULL,
        benchmark_strategy TEXT NOT NULL, trend_threshold REAL,
        display_precision INTEGER NOT NULL, calculation_version TEXT NOT NULL,
        formula TEXT, applicable_org_types TEXT, metadata_version TEXT,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS organizations (
        org_id TEXT PRIMARY KEY, org_code TEXT UNIQUE, org_type TEXT NOT NULL,
        name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
        parent_org_id TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS task_status_history (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL,
        details TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS evaluation_runs (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, model TEXT NOT NULL,
        temperature REAL NOT NULL, prompt_version TEXT NOT NULL,
        schema_version TEXT NOT NULL, total_cases INTEGER NOT NULL,
        completed_cases INTEGER NOT NULL, metrics TEXT NOT NULL,
        gate_passed INTEGER NOT NULL, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, completed_at TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS evaluation_cases (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, case_id TEXT NOT NULL,
        input_snapshot TEXT NOT NULL, allowed_conclusions TEXT NOT NULL,
        forbidden_conclusions TEXT NOT NULL, required_evidence TEXT NOT NULL,
        expected_recommendations TEXT NOT NULL, status TEXT NOT NULL,
        output TEXT, error_type TEXT, fallback_success INTEGER NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, status TEXT NOT NULL,
        user_id TEXT NOT NULL, role TEXT NOT NULL, org_id TEXT, branch TEXT, period TEXT,
        target_id TEXT, model TEXT, prompt_version TEXT, schema_version TEXT,
        data_version TEXT, rule_version TEXT, latency_ms INTEGER,
        token_usage INTEGER, error_type TEXT, details TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS data_backups (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, branch TEXT NOT NULL,
        period TEXT NOT NULL, goal TEXT NOT NULL, goal_payload TEXT NOT NULL,
        plan TEXT NOT NULL, result TEXT, status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE, model TEXT,
        prompt_version TEXT NOT NULL, schema_version TEXT NOT NULL,
        tool_version TEXT NOT NULL, error_type TEXT,
        risk_level TEXT NOT NULL DEFAULT 'medium',
        validation_policy TEXT NOT NULL DEFAULT 'strict',
        validation_report TEXT, execution_mode TEXT NOT NULL DEFAULT 'deterministic',
        created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS agent_steps (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_index INTEGER NOT NULL,
        title TEXT NOT NULL, tool_name TEXT NOT NULL, input_payload TEXT NOT NULL,
        output_payload TEXT, status TEXT NOT NULL, error_type TEXT,
        started_at TEXT, completed_at TEXT,
        UNIQUE(run_id, step_index)
    )""",
    """CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
        org_id TEXT NOT NULL, tool_name TEXT NOT NULL, tool_version TEXT NOT NULL,
        input_hash TEXT NOT NULL, input_payload TEXT NOT NULL,
        output_payload TEXT, status TEXT NOT NULL, latency_ms INTEGER NOT NULL,
        calculation_version TEXT, source TEXT,
        error_type TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(run_id, step_id, input_hash)
    )""",
    """CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT,
        memory_type TEXT NOT NULL, memory_key TEXT NOT NULL,
        payload TEXT NOT NULL, source_id TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(org_id, user_id, memory_type, memory_key)
    )""",
    """CREATE TABLE IF NOT EXISTS evaluation_versions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, dataset_version TEXT NOT NULL,
        blind_set_version TEXT, prompt_version TEXT NOT NULL,
        schema_version TEXT NOT NULL, tool_version TEXT NOT NULL,
        case_count INTEGER NOT NULL, frozen INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS evaluation_scores (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, case_id TEXT NOT NULL,
        numeric_score REAL NOT NULL, evidence_score REAL NOT NULL,
        relevance_score REAL NOT NULL, specificity_score REAL NOT NULL,
        safety_score REAL NOT NULL, critical_violation INTEGER NOT NULL,
        details TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS human_reviews (
        id TEXT PRIMARY KEY, target_id TEXT NOT NULL, target_type TEXT NOT NULL,
        org_id TEXT, reviewer_id TEXT NOT NULL, reviewer_role TEXT NOT NULL,
        factual_score INTEGER NOT NULL, relevance_score INTEGER NOT NULL,
        specificity_score INTEGER NOT NULL, actionability_score INTEGER NOT NULL,
        decision TEXT NOT NULL, comment TEXT, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS shadow_runs (
        id TEXT PRIMARY KEY, agent_run_id TEXT, org_id TEXT NOT NULL,
        branch TEXT NOT NULL, period TEXT NOT NULL, model TEXT,
        candidate_output TEXT NOT NULL, validation_report TEXT NOT NULL,
        status TEXT NOT NULL, visible_to_user INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS release_gates (
        id TEXT PRIMARY KEY, evaluation_run_id TEXT, dataset_version TEXT NOT NULL,
        metrics TEXT NOT NULL, blockers TEXT NOT NULL, passed INTEGER NOT NULL,
        approved_by TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    )""",
]

MIGRATION_COLUMNS = {
    "diagnoses": {"org_id": "TEXT", "schema_version": "TEXT"},
    "evidence": {
        "org_id": "TEXT", "metric_id": "TEXT", "direction": "TEXT",
        "benchmark_type": "TEXT", "benchmark_label": "TEXT",
        "calculation_version": "TEXT",
    },
    "interpretations": {"org_id": "TEXT"},
    "messages": {"org_id": "TEXT"},
    "feedback": {"org_id": "TEXT"},
    "remediation_tasks": {
        "source_recommendation_id": "TEXT",
        "org_id": "TEXT",
        "metric_id": "TEXT",
    },
    "remediation_reviews": {
        "org_id": "TEXT",
        "change_ratio": "REAL",
        "previous_target_distance": "REAL",
        "current_target_distance": "REAL",
        "target_distance_change": "REAL",
        "rank_change": "REAL",
    },
    "audit_logs": {"org_id": "TEXT"},
    "metric_metadata": {
        "formula": "TEXT", "applicable_org_types": "TEXT",
        "metadata_version": "TEXT",
    },
    "agent_runs": {
        "risk_level": "TEXT NOT NULL DEFAULT 'medium'",
        "validation_policy": "TEXT NOT NULL DEFAULT 'strict'",
        "validation_report": "TEXT",
        "execution_mode": "TEXT NOT NULL DEFAULT 'deterministic'",
    },
    "tool_executions": {
        "calculation_version": "TEXT", "source": "TEXT",
    },
}


def init_db():
    with connection() as conn:
        cur = conn.cursor()
        for statement in SCHEMA:
            cur.execute(statement)
        if _is_postgres():
            for table, columns in MIGRATION_COLUMNS.items():
                for column, definition in columns.items():
                    cur.execute(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {definition}"
                    )
        else:
            for table, columns in MIGRATION_COLUMNS.items():
                existing = {
                    row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()
                }
                for column, definition in columns.items():
                    if column not in existing:
                        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        branch_tables = (
            "diagnoses", "evidence", "interpretations", "messages", "feedback",
            "remediation_tasks", "remediation_reviews", "audit_logs",
        )
        names = set()
        for table in branch_tables:
            cur.execute(f"SELECT DISTINCT branch FROM {table} WHERE branch IS NOT NULL")
            names.update(row[0] for row in cur.fetchall() if row[0])
        normalized_to_names = {}
        for name in names:
            normalized_to_names.setdefault(normalize_org_name(name), set()).add(name)
        ambiguous = {
            normalized: sorted(values)
            for normalized, values in normalized_to_names.items()
            if len(values) > 1
        }
        if ambiguous:
            raise RuntimeError(f"机构名称无法唯一映射：{ambiguous}")
        timestamp = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat()
        for normalized, values in normalized_to_names.items():
            name = next(iter(values))
            org_id = stable_org_id(name)
            cur.execute(
                _sql(
                    """INSERT INTO organizations
                    (org_id,org_code,org_type,name,normalized_name,parent_org_id,
                     active,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(org_id) DO UPDATE SET
                    name=excluded.name,normalized_name=excluded.normalized_name,
                    updated_at=excluded.updated_at"""
                ),
                (org_id, org_id, "branch", name, normalized, None, 1, timestamp, timestamp),
            )
            for table in branch_tables:
                cur.execute(
                    _sql(f"UPDATE {table} SET org_id=? WHERE branch=? AND org_id IS NULL"),
                    (org_id, name),
                )
