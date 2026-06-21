import hashlib
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

from fastapi.testclient import TestClient

from backend import app as app_module
from backend import db


class ShareLinkApiTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        db.DATABASE_URL = "sqlite:///" + str(Path(self.tempdir.name) / "shares.db")
        db.init_db()
        self.client = TestClient(app_module.app, raise_server_exceptions=False)
        self.admin = {
            "X-User-Id": "share-admin",
            "X-Role": "admin",
            "X-Branches": "*",
        }
        self.branch_user = {
            "X-User-Id": "share-user",
            "X-Role": "branch",
            "X-Branches": "ORG_A",
        }
        timestamp = datetime.now(timezone.utc).isoformat()
        for org_id, name in (("ORG_A", "A分公司"), ("ORG_B", "B分公司")):
            db.execute(
                """INSERT INTO organizations
                (org_id,org_code,org_type,name,normalized_name,parent_org_id,
                 active,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    org_id, org_id, "branch", name, db.normalize_org_name(name),
                    None, 1, timestamp, timestamp,
                ),
            )

    def tearDown(self):
        self.client.close()
        self.tempdir.cleanup()

    @staticmethod
    def version_payload(period, a_value, b_value):
        return {
            "currentMonth": period,
            "currentPlanKey": "2026-v1",
            "_importTimes": {
                "actuals": {period: "2026-06-01T00:00:00+00:00"},
                "plans": {"2026-v1": "2026-01-01T00:00:00+00:00"},
                "unknown": {"secret": 987654321},
            },
            "_alertRules": [{"field": "经营利润", "op": "<", "value": 0}],
            "__rulesConfigured": True,
            "_unknownRoot": {"branch": "B分公司", "secret": 987654321},
            "actuals": {
                period: {
                    "branches": [
                        {
                            "orgId": "ORG_A", "n": "A分公司", "r": "第一责任区",
                            "d": {"经营利润": a_value, "已赚保费": 1000},
                        },
                        {
                            "orgId": "ORG_B", "n": "B分公司", "r": "第二责任区",
                            "d": {"经营利润": b_value, "已赚保费": 2000},
                        },
                    ],
                    "regions": {
                        "第一责任区": {"经营利润": a_value},
                        "第二责任区": {"经营利润": b_value},
                    },
                    "national": {"经营利润": a_value + b_value},
                }
            },
            "_merged": {
                period: {
                    "branches": [
                        {
                            "orgId": "ORG_A", "n": "A分公司",
                            "d": {"泄露检测值": 123456789},
                        },
                        {
                            "orgId": "ORG_B", "n": "B分公司",
                            "d": {"泄露检测值": 987654321},
                        },
                    ],
                    "regions": {"第二责任区": {"泄露检测值": 987654321}},
                    "national": {"泄露检测值": 987654321},
                }
            },
            "_plans": {
                "2026-v1": {
                    "branches": [
                        {
                            "orgId": "ORG_A", "n": "A分公司", "r": "第一责任区",
                            "d": {"经营利润年度计划": a_value * 12},
                        },
                        {
                            "orgId": "ORG_B", "n": "B分公司", "r": "第二责任区",
                            "d": {"经营利润年度计划": b_value * 12},
                        },
                    ],
                    "regions": {
                        "第一责任区": {"经营利润年度计划": a_value * 12},
                        "第二责任区": {"经营利润年度计划": b_value * 12},
                    },
                    "national": {
                        "经营利润年度计划": (a_value + b_value) * 12
                    },
                    "planVersion": "2026-v1",
                }
            },
        }

    def create_version(self, period, a_value, b_value, publish=True):
        created = self.client.post(
            "/api/data-versions",
            json={
                "period": period,
                "payload": self.version_payload(period, a_value, b_value),
            },
            headers=self.admin,
        )
        self.assertEqual(created.status_code, 200, created.text)
        version_id = created.json()["id"]
        validated = self.client.post(
            f"/api/data-versions/{version_id}/validate", headers=self.admin
        )
        self.assertEqual(validated.status_code, 200, validated.text)
        if publish:
            published = self.client.post(
                f"/api/data-versions/{version_id}/publish", headers=self.admin
            )
            self.assertEqual(published.status_code, 200, published.text)
        return version_id

    def create_link(self, *, mode="latest", version_id=None,
                    allowed=None, allow_export=False, expires_at=None,
                    enabled=True, headers=None):
        body = {
            "mode": mode,
            "enabled": enabled,
            "allowedOrgIds": allowed or ["ORG_A"],
            "allowExport": allow_export,
        }
        if version_id:
            body["fixedDataVersionId"] = version_id
        if expires_at is not None:
            body["expiresAt"] = expires_at
        return self.client.post(
            "/api/share-links", json=body, headers=headers or self.admin
        )

    def shared(self, token):
        return self.client.get(f"/api/shared-data/{token}")

    def test_non_admin_cannot_manage_links(self):
        version_id = self.create_version("2026-06", 10, 20)
        denied_create = self.create_link(headers=self.branch_user)
        self.assertEqual(denied_create.status_code, 403)

        created = self.create_link(mode="fixed", version_id=version_id)
        self.assertEqual(created.status_code, 200, created.text)
        link_id = created.json()["id"]
        self.assertEqual(
            self.client.get("/api/share-links", headers=self.branch_user).status_code,
            403,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/share-links/{link_id}",
                json={"enabled": False},
                headers=self.branch_user,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                f"/api/share-links/{link_id}/rotate",
                headers=self.branch_user,
            ).status_code,
            403,
        )

    def test_latest_and_fixed_resolve_correct_published_versions(self):
        fixed_id = self.create_version("2026-05", 10, 20)
        fixed = self.create_link(mode="fixed", version_id=fixed_id)
        latest = self.create_link(mode="latest")
        newer_id = self.create_version("2026-06", 30, 40)

        fixed_data = self.shared(fixed.json()["token"])
        latest_data = self.shared(latest.json()["token"])
        self.assertEqual(fixed_data.status_code, 200, fixed_data.text)
        self.assertEqual(latest_data.status_code, 200, latest_data.text)
        self.assertEqual(fixed_data.json()["dataVersion"]["id"], fixed_id)
        self.assertEqual(latest_data.json()["dataVersion"]["id"], newer_id)

    def test_token_is_only_returned_on_create_or_rotate_and_stored_as_hash(self):
        self.create_version("2026-06", 10, 20)
        created = self.create_link()
        token = created.json()["token"]
        self.assertGreaterEqual(len(token), 40)
        row = db.fetch_one(
            "SELECT * FROM share_links WHERE id=?", (created.json()["id"],)
        )
        self.assertNotEqual(row["token_hash"], token)
        self.assertEqual(
            row["token_hash"], hashlib.sha256(token.encode("utf-8")).hexdigest()
        )
        listing = self.client.get("/api/share-links", headers=self.admin)
        self.assertNotIn("token", listing.json()[0])
        self.assertNotIn(token, str(listing.json()))

    def test_invalid_disabled_expired_and_old_tokens_are_rejected(self):
        self.create_version("2026-06", 10, 20)
        invalid = self.shared("invalid-token")
        self.assertEqual(invalid.status_code, 404)
        self.assertEqual(invalid.headers["cache-control"], "private, no-store")

        disabled = self.create_link(enabled=False)
        self.assertEqual(self.shared(disabled.json()["token"]).status_code, 404)

        expired = self.create_link(
            expires_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        )
        self.assertEqual(self.shared(expired.json()["token"]).status_code, 404)

        active = self.create_link()
        old_token = active.json()["token"]
        rotated = self.client.post(
            f"/api/share-links/{active.json()['id']}/rotate", headers=self.admin
        )
        self.assertEqual(rotated.status_code, 200, rotated.text)
        self.assertEqual(self.shared(old_token).status_code, 404)
        self.assertEqual(self.shared(rotated.json()["token"]).status_code, 200)

    def test_server_filters_branch_b_and_removes_aggregate_leakage(self):
        self.create_version("2026-06", 10, 999)
        created = self.create_link(allowed=["ORG_A"])
        response = self.shared(created.json()["token"])
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["payload"]
        snapshot = payload["actuals"]["2026-06"]
        self.assertEqual(
            [branch["orgId"] for branch in snapshot["branches"]], ["ORG_A"]
        )
        self.assertNotIn("B分公司", str(payload))
        self.assertNotIn("national", snapshot)
        self.assertNotIn("regions", snapshot)
        plan = payload["_plans"]["2026-v1"]
        self.assertEqual(
            [branch["orgId"] for branch in plan["branches"]], ["ORG_A"]
        )
        self.assertEqual(plan["branches"][0]["d"]["经营利润年度计划"], 120)
        self.assertNotIn("national", plan)
        self.assertNotIn("regions", plan)
        self.assertEqual(plan["planVersion"], "2026-v1")
        self.assertEqual(payload["currentMonth"], "2026-06")
        self.assertEqual(payload["currentPlanKey"], "2026-v1")
        self.assertIn("_importTimes", payload)
        self.assertEqual(
            payload["_importTimes"],
            {
                "actuals": {"2026-06": "2026-06-01T00:00:00+00:00"},
                "plans": {"2026-v1": "2026-01-01T00:00:00+00:00"},
            },
        )
        self.assertIn("_alertRules", payload)
        self.assertTrue(payload["__rulesConfigured"])

    def test_share_uses_root_allowlist_and_never_returns_merged_or_unknown_data(self):
        self.create_version("2026-06", 10, 999)
        created = self.create_link(allowed=["ORG_A"])
        response = self.shared(created.json()["token"])
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()["payload"]
        serialized = response.text
        self.assertEqual(
            set(payload),
            {
                "actuals", "_plans", "currentMonth", "currentPlanKey",
                "_importTimes", "_alertRules", "__rulesConfigured",
            },
        )
        self.assertNotIn("_merged", payload)
        self.assertNotIn("_unknownRoot", payload)
        self.assertNotIn("B分公司", serialized)
        self.assertNotIn("987654321", serialized)
        self.assertNotIn("national", serialized)
        self.assertNotIn("regions", serialized)
        self.assertNotIn("第二责任区", serialized)

    def test_fixed_returns_original_after_new_same_period_version_is_published(self):
        fixed_id = self.create_version("2026-06", 10, 20)
        created = self.create_link(mode="fixed", version_id=fixed_id)
        replacement_id = self.create_version("2026-06", 30, 40)
        response = self.shared(created.json()["token"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["dataVersion"]["id"], fixed_id)
        self.assertNotEqual(response.json()["dataVersion"]["id"], replacement_id)
        self.assertEqual(
            db.fetch_one(
                "SELECT status FROM data_versions WHERE id=?", (fixed_id,)
            )["status"],
            "archived",
        )

    def test_allow_export_and_no_store_are_returned(self):
        self.create_version("2026-06", 10, 20)
        created = self.create_link(allow_export=True)
        response = self.shared(created.json()["token"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["allowExport"])
        self.assertFalse(response.json()["aiEnabled"])
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_share_never_returns_non_published_versions(self):
        validated_id = self.create_version("2026-06", 10, 20, publish=False)
        latest = self.create_link()
        self.assertEqual(self.shared(latest.json()["token"]).status_code, 404)

        fixed_unpublished = self.create_link(
            mode="fixed", version_id=validated_id
        )
        self.assertEqual(fixed_unpublished.status_code, 422)

        first_id = self.create_version("2026-06", 30, 40)
        fixed = self.create_link(mode="fixed", version_id=first_id)
        second = self.client.post(
            "/api/data-versions",
            json={
                "period": "2026-06",
                "payload": self.version_payload("2026-06", 50, 60),
            },
            headers=self.admin,
        )
        second_id = second.json()["id"]
        self.client.post(
            f"/api/data-versions/{second_id}/validate", headers=self.admin
        )
        self.client.post(
            f"/api/data-versions/{second_id}/publish", headers=self.admin
        )
        archived_response = self.shared(fixed.json()["token"])
        self.assertEqual(archived_response.status_code, 200)
        self.assertEqual(archived_response.json()["dataVersion"]["id"], first_id)

    def test_access_audit_never_contains_plaintext_token(self):
        self.create_version("2026-06", 10, 20)
        created = self.create_link()
        token = created.json()["token"]
        self.assertEqual(self.shared(token).status_code, 200)
        audits = db.fetch_all(
            "SELECT * FROM audit_logs WHERE action='share_link.access'"
        )
        self.assertTrue(audits)
        self.assertNotIn(token, str(audits))
        row = db.fetch_one(
            "SELECT * FROM share_links WHERE id=?", (created.json()["id"],)
        )
        self.assertNotIn(token, str(row))

    def test_share_frontend_route_uses_root_static_assets(self):
        response = self.client.get("/share/test-token")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertIn('<base href="/">', response.text)

        base_url = urljoin(str(response.url), "/")
        dashboard_url = urljoin(base_url, "dashboard-data.js?v=2062002")
        self.assertEqual(
            dashboard_url,
            "http://testserver/dashboard-data.js?v=2062002",
        )
        self.assertNotIn("/share/dashboard-data.js", dashboard_url)

        for asset in (
            "dashboard-diagnosis.css?v=2061812",
            "dashboard-data.js?v=2062002",
            "dashboard-share.js?v=2062001",
            "dashboard-main.js?v=2062002",
        ):
            asset_response = self.client.get("/" + asset)
            self.assertEqual(asset_response.status_code, 200, asset)

    def test_frontend_entry_routes_share_the_same_root_base(self):
        for route in ("/", "/?share=test-token", "/share/test-token"):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200, route)
            self.assertIn('<base href="/">', response.text)

if __name__ == "__main__":
    unittest.main()
