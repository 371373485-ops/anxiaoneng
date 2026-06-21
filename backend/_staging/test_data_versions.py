import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import app as app_module
from backend import data_versions, db


class DataVersionApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        db.DATABASE_URL = "sqlite:///" + str(Path(self.tempdir.name) / "versions.db")
        db.init_db()
        self.client = TestClient(app_module.app, raise_server_exceptions=False)
        self.admin = {
            "X-User-Id": "version-admin",
            "X-Role": "admin",
            "X-Branches": "*",
        }
        self.non_admin = {
            "X-User-Id": "version-user",
            "X-Role": "hq_management",
            "X-Branches": "*",
        }

    def tearDown(self):
        self.client.close()
        self.tempdir.cleanup()

    @staticmethod
    def payload(period="2026-06", value=100):
        return {
            "actuals": {
                period: {
                    "branches": [
                        {
                            "n": "测试分公司",
                            "r": "第一责任区",
                            "d": {"经营利润": value, "已赚保费": 1000},
                        }
                    ],
                    "regions": {
                        "第一责任区": {"经营利润": value, "已赚保费": 1000}
                    },
                    "national": {"经营利润": value, "已赚保费": 1000},
                }
            }
        }

    def create(self, *, period="2026-06", value=100, payload=None, headers=None):
        return self.client.post(
            "/api/data-versions",
            json={
                "period": period,
                "payload": payload if payload is not None else self.payload(period, value),
            },
            headers=headers or self.admin,
        )

    def validate(self, version_id, headers=None):
        return self.client.post(
            f"/api/data-versions/{version_id}/validate",
            headers=headers or self.admin,
        )

    def publish(self, version_id, headers=None):
        return self.client.post(
            f"/api/data-versions/{version_id}/publish",
            headers=headers or self.admin,
        )

    def create_validated(self, *, period="2026-06", value=100):
        created = self.create(period=period, value=value)
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        validated = self.validate(version_id)
        self.assertEqual(validated.status_code, 200, validated.text)
        return version_id

    def test_non_admin_cannot_create_or_publish(self):
        denied_create = self.create(headers=self.non_admin)
        self.assertEqual(denied_create.status_code, 403)

        created = self.create(value=101)
        self.assertEqual(created.status_code, 200, created.text)
        denied_validate = self.validate(created.json()["id"], headers=self.non_admin)
        self.assertEqual(denied_validate.status_code, 403)

        version_id = self.create_validated(value=102)
        denied_publish = self.publish(version_id, headers=self.non_admin)
        self.assertEqual(denied_publish.status_code, 403)
        self.assertEqual(
            db.fetch_one(
                "SELECT status FROM data_versions WHERE id=?", (version_id,)
            )["status"],
            "validated",
        )

    def test_branch_region_and_hq_cannot_read_list_or_detail(self):
        created = self.create(value=103)
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        for role in ("branch", "region", "hq_management"):
            with self.subTest(role=role):
                headers = {
                    "X-User-Id": f"{role}-reader",
                    "X-Role": role,
                    "X-Branches": "*",
                }
                denied_list = self.client.get(
                    "/api/data-versions", headers=headers
                )
                denied_detail = self.client.get(
                    f"/api/data-versions/{version_id}", headers=headers
                )
                self.assertEqual(denied_list.status_code, 403)
                self.assertEqual(denied_detail.status_code, 403)

    def test_plans_only_payload_is_rejected_during_creation(self):
        response = self.create(payload={
            "_plans": {
                "2026-v1": {
                    "branches": [{
                        "n": "测试分公司",
                        "r": "第一责任区",
                        "d": {"经营利润年度计划": 1000},
                    }]
                }
            }
        })
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("_plans", response.json()["detail"])
        self.assertEqual(
            db.fetch_one("SELECT COUNT(*) AS total FROM data_versions")["total"],
            0,
        )
        self.assertEqual(
            db.fetch_one(
                "SELECT COUNT(*) AS total FROM data_version_events"
            )["total"],
            0,
        )

    def test_unvalidated_version_cannot_publish(self):
        created = self.create()
        self.assertEqual(created.status_code, 200, created.text)
        response = self.publish(created.json()["id"])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self.client.get(
                f"/api/data-versions/{created.json()['id']}", headers=self.admin
            ).json()["status"],
            "draft",
        )

    def test_duplicate_hash_cannot_be_created(self):
        payload = self.payload()
        first = self.create(payload=payload)
        second = self.create(
            payload={
                "actuals": {
                    "2026-06": {
                        "national": {"已赚保费": 1000, "经营利润": 100},
                        "regions": {
                            "第一责任区": {"已赚保费": 1000, "经营利润": 100}
                        },
                        "branches": [{
                            "d": {"已赚保费": 1000, "经营利润": 100},
                            "r": "第一责任区",
                            "n": "测试分公司",
                        }],
                    }
                }
            }
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 409, second.text)
        self.assertEqual(
            db.fetch_one("SELECT COUNT(*) AS total FROM data_versions")["total"],
            1,
        )

    def test_payload_size_limit_is_enforced(self):
        self.assertEqual(data_versions.MAX_PAYLOAD_BYTES, 20 * 1024 * 1024)
        with patch.object(data_versions, "MAX_PAYLOAD_BYTES", 128):
            response = self.create(payload={"value": "x" * 256})
        self.assertEqual(response.status_code, 413, response.text)
        self.assertEqual(
            db.fetch_one("SELECT COUNT(*) AS total FROM data_versions")["total"],
            0,
        )

    def test_invalid_payload_cannot_pass_validation(self):
        created = self.create(payload={
            "actuals": {
                "2026-06": {
                    "branches": [{"n": "", "d": {"经营利润": "not-number"}}],
                    "national": [],
                }
            }
        })
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        response = self.validate(version_id)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(
            db.fetch_one(
                "SELECT status FROM data_versions WHERE id=?", (version_id,)
            )["status"],
            "draft",
        )
        event = db.fetch_one(
            """SELECT * FROM data_version_events
               WHERE data_version_id=? AND event_type='validation_failed'""",
            (version_id,),
        )
        audit = db.fetch_one(
            """SELECT * FROM audit_logs
               WHERE target_id=? AND action='data_version.validate'""",
            (version_id,),
        )
        self.assertIsNotNone(event)
        self.assertEqual(audit["status"], "failed")
        self.assertEqual(audit["error_type"], "invalid_payload")

    def test_publish_archives_previous_version_and_records_transitions(self):
        first_id = self.create_validated(value=100)
        first_publish = self.publish(first_id)
        self.assertEqual(first_publish.status_code, 200, first_publish.text)

        second_id = self.create_validated(value=200)
        second_publish = self.publish(second_id)
        self.assertEqual(second_publish.status_code, 200, second_publish.text)

        first = self.client.get(
            f"/api/data-versions/{first_id}", headers=self.admin
        ).json()
        second = self.client.get(
            f"/api/data-versions/{second_id}", headers=self.admin
        ).json()
        self.assertEqual(first["status"], "archived")
        self.assertEqual(second["status"], "published")
        self.assertEqual(
            [event["eventType"] for event in first["events"]],
            ["created", "validated", "published", "archived"],
        )
        self.assertEqual(
            [event["eventType"] for event in second["events"]],
            ["created", "validated", "published"],
        )
        self.assertEqual(
            [event["eventSequence"] for event in first["events"]],
            [1, 2, 3, 4],
        )
        self.assertEqual(
            [event["eventSequence"] for event in second["events"]],
            [1, 2, 3],
        )
        published = self.client.get(
            "/api/data-versions?period=2026-06&status=published",
            headers=self.admin,
        )
        self.assertEqual(published.status_code, 200)
        self.assertEqual([item["id"] for item in published.json()], [second_id])

    def test_publish_failure_rolls_back_archive_events_and_audit(self):
        first_id = self.create_validated(value=100)
        self.assertEqual(self.publish(first_id).status_code, 200)
        second_id = self.create_validated(value=200)

        with patch.object(
            data_versions, "_publish_target", side_effect=RuntimeError("forced")
        ):
            failed = self.publish(second_id)
        self.assertEqual(failed.status_code, 500)
        self.assertEqual(
            db.fetch_one(
                "SELECT status FROM data_versions WHERE id=?", (first_id,)
            )["status"],
            "published",
        )
        self.assertEqual(
            db.fetch_one(
                "SELECT status FROM data_versions WHERE id=?", (second_id,)
            )["status"],
            "validated",
        )
        self.assertIsNone(
            db.fetch_one(
                """SELECT id FROM data_version_events
                   WHERE data_version_id=? AND event_type='archived'""",
                (first_id,),
            )
        )
        failed_audit = db.fetch_one(
            """SELECT * FROM audit_logs
               WHERE target_id=? AND action='data_version.publish'""",
            (second_id,),
        )
        self.assertEqual(failed_audit["status"], "failed")
        self.assertEqual(failed_audit["error_type"], "publish_failed")

    def test_successful_actions_have_matching_audit_and_events(self):
        version_id = self.create_validated()
        self.assertEqual(self.publish(version_id).status_code, 200)
        actions = db.fetch_all(
            """SELECT action,status FROM audit_logs
               WHERE target_id=?""",
            (version_id,),
        )
        events = db.fetch_all(
            """SELECT event_type,from_status,to_status
               FROM data_version_events
               WHERE data_version_id=? ORDER BY event_sequence ASC""",
            (version_id,),
        )
        actions_by_name = {}
        for record in actions:
            actions_by_name.setdefault(record["action"], []).append(record["status"])
        self.assertEqual(
            actions_by_name,
            {
                "data_version.create": ["success"],
                "data_version.validate": ["success"],
                "data_version.publish": ["success"],
            },
        )
        self.assertEqual(
            events,
            [
                {"event_type": "created", "from_status": None, "to_status": "draft"},
                {
                    "event_type": "validated",
                    "from_status": "draft",
                    "to_status": "validated",
                },
                {
                    "event_type": "published",
                    "from_status": "validated",
                    "to_status": "published",
                },
            ],
        )


    def test_event_sequences_are_continuous_and_same_timestamp_is_deterministic(self):
        fixed_time = "2026-06-21T00:00:00+00:00"
        with patch.object(data_versions, "now_iso", return_value=fixed_time):
            version_id = self.create_validated(value=301)
            self.assertEqual(self.publish(version_id).status_code, 200)
        response = self.client.get(
            f"/api/data-versions/{version_id}", headers=self.admin
        )
        self.assertEqual(response.status_code, 200, response.text)
        events = response.json()["events"]
        self.assertEqual(
            [(event["eventSequence"], event["eventType"]) for event in events],
            [(1, "created"), (2, "validated"), (3, "published")],
        )
        self.assertEqual({event["createdAt"] for event in events}, {fixed_time})

    def test_concurrent_event_writes_allocate_unique_continuous_sequences(self):
        created = self.create(value=302)
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        actor = data_versions.Actor(user_id="concurrent-test", role="admin")
        barrier = threading.Barrier(8)
        errors = []

        def write_event(index):
            try:
                barrier.wait(timeout=5)
                with db.transaction() as tx:
                    data_versions._event(
                        tx, version_id, f"concurrent_{index}", actor,
                        from_status="draft", to_status="draft",
                    )
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)

        threads = [threading.Thread(target=write_event, args=(index,)) for index in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertFalse(errors, errors)
        rows = db.fetch_all(
            """SELECT event_sequence FROM data_version_events
               WHERE data_version_id=? ORDER BY event_sequence ASC""",
            (version_id,),
        )
        sequences = [row["event_sequence"] for row in rows]
        self.assertEqual(sequences, list(range(1, 10)))
        self.assertEqual(len(sequences), len(set(sequences)))

    def test_failed_event_transaction_rolls_back_sequence_without_duplicate(self):
        created = self.create(value=303)
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        actor = data_versions.Actor(user_id="rollback-test", role="admin")
        with self.assertRaises(RuntimeError):
            with db.transaction() as tx:
                data_versions._event(
                    tx, version_id, "rolled_back", actor,
                    from_status="draft", to_status="draft",
                )
                raise RuntimeError("force rollback")
        with db.transaction() as tx:
            data_versions._event(
                tx, version_id, "after_rollback", actor,
                from_status="draft", to_status="draft",
            )
        rows = db.fetch_all(
            """SELECT event_sequence,event_type FROM data_version_events
               WHERE data_version_id=? ORDER BY event_sequence ASC""",
            (version_id,),
        )
        self.assertEqual(
            rows,
            [
                {"event_sequence": 1, "event_type": "created"},
                {"event_sequence": 2, "event_type": "after_rollback"},
            ],
        )
if __name__ == "__main__":
    unittest.main()
