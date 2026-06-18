import tempfile
import unittest
from pathlib import Path

from backend import db


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        db.DATABASE_URL = "sqlite:///" + str(Path(self.tempdir.name) / "test.db")
        db.init_db()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_schema_contains_core_entities(self):
        with db.connection() as conn:
            names = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        expected = {
            "diagnoses", "evidence", "interpretations", "messages", "feedback",
            "remediation_tasks", "remediation_reviews", "audit_logs",
            "data_backups", "metric_metadata", "task_status_history",
            "organizations", "evaluation_runs", "evaluation_cases",
            "agent_runs", "agent_steps", "tool_executions", "agent_memories",
            "evaluation_versions", "evaluation_scores", "human_reviews",
            "shadow_runs", "release_gates",
        }
        self.assertTrue(expected.issubset(names))

    def test_transaction_rolls_back_all_writes(self):
        with self.assertRaises(RuntimeError):
            with db.transaction() as tx:
                tx.execute(
                    """INSERT INTO organizations
                    (org_id,org_code,org_type,name,normalized_name,parent_org_id,
                     active,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        "ROLLBACK", "ROLLBACK", "branch", "回滚机构", "回滚机构",
                        None, 1, "now", "now",
                    ),
                )
                raise RuntimeError("force rollback")
        self.assertIsNone(
            db.fetch_one("SELECT * FROM organizations WHERE org_id=?", ("ROLLBACK",))
        )

    def test_init_db_is_repeatable_and_adds_migration_columns(self):
        db.init_db()
        with db.connection() as conn:
            task_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(remediation_tasks)")
            }
            review_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(remediation_reviews)")
            }
        self.assertTrue(
            {"source_recommendation_id", "org_id", "metric_id"}.issubset(task_columns)
        )
        self.assertTrue(
            {"change_ratio", "target_distance_change", "rank_change"}.issubset(
                review_columns
            )
        )

    def test_existing_branch_names_are_backfilled_to_org_ids(self):
        db.execute(
            """INSERT INTO diagnoses
            (id,branch,period,data_version,rule_version,created_by,created_at,
             risk_level,summary,payload)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                "legacy", " Legacy Branch ", "2026-01", "d1", "r1",
                "tester", "2026-01-01T00:00:00+00:00", "关注", "legacy", "{}",
            ),
        )
        db.init_db()
        diagnosis = db.fetch_one("SELECT * FROM diagnoses WHERE id=?", ("legacy",))
        organization = db.fetch_one(
            "SELECT * FROM organizations WHERE org_id=?", (diagnosis["org_id"],)
        )
        self.assertEqual(organization["normalized_name"], "legacybranch")


if __name__ == "__main__":
    unittest.main()
