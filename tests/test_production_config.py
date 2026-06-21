import json
import os
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


class ProductionConfigTests(unittest.TestCase):
    def setUp(self):
        self.compose = yaml.safe_load(
            (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        )

    def test_compose_separates_admin_and_public_gateways(self):
        services = self.compose["services"]
        self.assertNotIn("ports", services["app"])
        self.assertEqual(services["app"]["expose"], ["8000"])
        self.assertEqual(
            services["admin-gateway"]["ports"],
            ["127.0.0.1:${ADMIN_GATEWAY_PORT:-8080}:8080"],
        )
        self.assertEqual(
            services["public-gateway"]["ports"],
            ["${PUBLIC_GATEWAY_BIND:-0.0.0.0}:${PUBLIC_GATEWAY_PORT:-8081}:8080"],
        )
        self.assertNotIn("environment", services["public-gateway"])
        self.assertNotIn("PROXY_SHARED_SECRET", str(services["public-gateway"]))
        self.assertNotIn("GATEWAY_USER", str(services["public-gateway"]))

    def test_compose_requires_non_default_production_secrets(self):
        text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertNotIn("change-me", text)
        self.assertIn("POSTGRES_PASSWORD is required", text)
        self.assertIn("PROXY_SHARED_SECRET is required", text)
        self.assertIn('AI_ENABLED: "false"', text)
        self.assertIn("AUTH_MODE: proxy", text)

    def test_admin_gateway_overwrites_identity_and_injects_proxy_secret(self):
        text = (ROOT / "ops" / "admin-nginx.conf.template").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            'proxy_set_header X-Authenticated-User "${GATEWAY_USER}"', text
        )
        self.assertIn(
            'proxy_set_header X-Authenticated-Role "${GATEWAY_ROLE}"', text
        )
        self.assertIn(
            'proxy_set_header X-Proxy-Secret "${PROXY_SHARED_SECRET}"', text
        )
        self.assertNotIn("proxy_pass http://127.0.0.1", text)
        self.assertIn("log_format admin_safe", text)
        self.assertNotIn("$request_uri", text)
        self.assertNotIn('"$request"', text)
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("--no-access-log", dockerfile)

    def test_public_gateway_is_anonymous_read_only_allowlist(self):
        text = (ROOT / "ops" / "public-nginx.conf").read_text(
            encoding="utf-8"
        )
        proxy = (ROOT / "ops" / "proxy_params").read_text(encoding="utf-8")
        self.assertIn("$request_method !~ ^(GET|HEAD)$", text)
        self.assertIn("^/share/[^/]+$", text)
        self.assertIn("^/api/shared-data/[^/]+$", text)
        self.assertIn("^/dashboard-[A-Za-z0-9_-]+\\.js$", text)
        self.assertIn("location /", text)
        self.assertIn("return 404", text)
        self.assertIn("log_format public_safe", text)
        self.assertIn("access_log /var/log/nginx/access.log public_safe", text)
        self.assertNotIn("$request_uri", text)
        self.assertNotIn('"$request"', text)
        for header in (
            "X-Authenticated-User", "X-Authenticated-Role",
            "X-Authenticated-Branches", "X-Proxy-Secret",
            "X-User-Id", "X-Role", "X-Branches",
        ):
            self.assertIn(f'proxy_set_header {header} "";', proxy)
        for private_path in (
            "/api/me", "/api/data-versions", "/api/share-links",
            "/save-backup", "/_data_backup.json",
        ):
            self.assertNotIn(f"location = {private_path}", text)

    def test_share_and_unlock_bootstrap_run_before_main_initialization(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertLess(
            html.index('src="dashboard-data.js'),
            html.index('src="dashboard-share.js'),
        )
        self.assertLess(
            html.index('src="dashboard-share.js'),
            html.index('src="dashboard-main.js'),
        )
        self.assertLess(
            html.index('src="pages/unlock.js'),
            html.index('src="dashboard-main.js'),
        )

    def test_sensitive_generated_files_are_ignored(self):
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        for pattern in (
            "*.db", "*.log", ".env", "backups/", "temp/",
            "evaluation-output/", "evaluation-results/",
        ):
            self.assertIn(pattern, ignore)
        docker_ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
        for pattern in ("*.db", "*.log", ".env", "_data_backup.json"):
            self.assertIn(pattern, docker_ignore)

@unittest.skipUnless(
    os.getenv("GATEWAY_E2E"), "requires running Docker Compose gateways"
)
class GatewayIsolationE2ETests(unittest.TestCase):
    admin_url = os.getenv("ADMIN_GATEWAY_URL", "http://127.0.0.1:8080")
    public_url = os.getenv("PUBLIC_GATEWAY_URL", "http://127.0.0.1:8081")

    def request(self, method, base, path, body=None, headers=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            base + path, data=data, method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, response.read().decode("utf-8")
        except HTTPError as error:
            return error.code, error.read().decode("utf-8")

    def test_admin_and_public_gateway_permissions(self):
        status, body = self.request("GET", self.admin_url, "/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["role"], "admin")

        for path in (
            "/", "/api/me", "/api/data-versions", "/api/share-links",
            "/save-backup", "/_data_backup.json", "/api/health",
        ):
            status, _ = self.request("GET", self.public_url, path)
            self.assertEqual(status, 404, path)
        status, _ = self.request(
            "GET", self.public_url, "/api/me",
            headers={
                "X-Authenticated-User": "attacker",
                "X-Authenticated-Role": "admin",
                "X-Proxy-Secret": "forged",
            },
        )
        self.assertEqual(status, 404)
        for method in ("POST", "PATCH", "PUT", "DELETE"):
            status, _ = self.request(method, self.public_url, "/api/data-versions")
            self.assertEqual(status, 405, method)

        for path in (
            "/share/test-token", "/dashboard-data.js",
            "/dashboard-diagnosis.css", "/chart.umd.min.js",
        ):
            status, _ = self.request("GET", self.public_url, path)
            self.assertEqual(status, 200, path)

        status, body = self.request("GET", self.admin_url, "/api/organizations?type=branch")
        self.assertEqual(status, 200)
        organizations = json.loads(body)
        self.assertTrue(organizations, "gateway E2E requires one branch organization")
        org_id = organizations[0]["orgId"]
        status, body = self.request("GET", self.admin_url, "/api/data-versions")
        self.assertEqual(status, 200)
        self.assertTrue(
            any(item["status"] == "published" for item in json.loads(body)),
            "gateway E2E requires one published data version",
        )

        link_body = {
            "mode": "latest", "enabled": True,
            "allowedOrgIds": [org_id], "allowExport": False,
        }
        status, body = self.request("POST", self.admin_url, "/api/share-links", link_body)
        self.assertEqual(status, 200)
        link = json.loads(body)
        token = link["token"]
        status, _ = self.request("GET", self.public_url, f"/api/shared-data/{token}")
        self.assertEqual(status, 200)
        status, _ = self.request("GET", self.public_url, f"/share/{token}")
        self.assertEqual(status, 200)
        status, _ = self.request(
            "PATCH", self.admin_url, f"/api/share-links/{link['id']}",
            {"enabled": False},
        )
        self.assertEqual(status, 200)
        status, _ = self.request("GET", self.public_url, f"/api/shared-data/{token}")
        self.assertEqual(status, 404)

        expired_body = {
            **link_body, "expiresAt": "2020-01-01T00:00:00Z",
        }
        status, body = self.request("POST", self.admin_url, "/api/share-links", expired_body)
        self.assertEqual(status, 200)
        expired_token = json.loads(body)["token"]
        status, error_body = self.request(
            "GET", self.public_url, f"/api/shared-data/{expired_token}"
        )
        self.assertEqual(status, 404)
        for secret_detail in ("/app", "postgresql", "Traceback", "PROXY_SHARED_SECRET"):
            self.assertNotIn(secret_detail, error_body)

@unittest.skipUnless(
    os.getenv("POSTGRES_TEST_URL"), "requires POSTGRES_TEST_URL or Docker Compose"
)
class PostgreSqlProductionFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from backend import db

        cls.db = db
        cls.previous_url = db.DATABASE_URL
        db.DATABASE_URL = os.environ["POSTGRES_TEST_URL"]
        db.init_db()
        cls._cleanup_acceptance_data()

    @classmethod
    def _cleanup_acceptance_data(cls):
        rows = cls.db.fetch_all(
            "SELECT id FROM data_versions WHERE period=?", ("2099-01",)
        )
        version_ids = [row["id"] for row in rows]
        if version_ids:
            placeholders = ",".join("?" for _ in version_ids)
            cls.db.execute(
                f"DELETE FROM share_links WHERE fixed_data_version_id IN ({placeholders})",
                tuple(version_ids),
            )
            cls.db.execute(
                f"DELETE FROM data_version_events WHERE data_version_id IN ({placeholders})",
                tuple(version_ids),
            )
            cls.db.execute(
                f"DELETE FROM audit_logs WHERE target_id IN ({placeholders})",
                tuple(version_ids),
            )
            cls.db.execute(
                f"DELETE FROM data_versions WHERE id IN ({placeholders})",
                tuple(version_ids),
            )
        cls.db.execute(
            "DELETE FROM share_links WHERE created_by=?", ("postgres-test",)
        )
        cls.db.execute(
            "DELETE FROM audit_logs WHERE user_id=?", ("postgres-test",)
        )
        cls.db.execute(
            "DELETE FROM organizations WHERE org_id=?", ("ORG_POSTGRES_TEST",)
        )

    @classmethod
    def tearDownClass(cls):
        cls._cleanup_acceptance_data()
        cls.db.DATABASE_URL = cls.previous_url

    def test_data_version_publish_share_rotate_and_unique_constraint(self):
        from backend import data_versions, share_links

        actor = data_versions.Actor(user_id="postgres-test", role="admin")
        share_actor = share_links.Actor(user_id="postgres-test", role="admin")
        period = "2099-01"
        timestamp = "2099-01-01T00:00:00+00:00"
        org_id = "ORG_POSTGRES_TEST"
        self.db.execute(
            """INSERT INTO organizations
            (org_id,org_code,org_type,name,normalized_name,parent_org_id,
             active,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(org_id) DO UPDATE SET updated_at=excluded.updated_at""",
            (
                org_id, org_id, "branch", "PostgreSQL测试机构",
                "postgresql测试机构", None, 1, timestamp, timestamp,
            ),
        )

        def payload(value):
            return {
                "currentMonth": period,
                "actuals": {
                    period: {
                        "branches": [{
                            "orgId": org_id, "n": "PostgreSQL测试机构",
                            "r": "第一责任区", "d": {"经营利润": value},
                        }],
                        "regions": {}, "national": {"经营利润": value},
                    }
                },
                "_plans": {},
            }

        first = data_versions.create_version(period, payload(101), actor)
        data_versions.validate_version(first["id"], actor)
        data_versions.publish_version(first["id"], actor)
        fixed = share_links.create_link(
            mode="fixed", fixed_data_version_id=first["id"], enabled=True,
            expires_at=None, allowed_org_ids=[org_id], allow_export=False,
            actor=share_actor,
        )
        self.assertEqual(
            share_links.access_shared_data(fixed["token"])["dataVersion"]["id"],
            first["id"],
        )
        old_token = fixed["token"]
        rotated = share_links.rotate_link(fixed["id"], share_actor)
        with self.assertRaises(share_links.ShareLinkAccessDenied):
            share_links.access_shared_data(old_token)
        self.assertEqual(
            share_links.access_shared_data(rotated["token"])["shareLinkId"],
            fixed["id"],
        )

        second = data_versions.create_version(period, payload(202), actor)
        data_versions.validate_version(second["id"], actor)
        data_versions.publish_version(second["id"], actor)
        statuses = {
            row["id"]: row["status"]
            for row in self.db.fetch_all(
                "SELECT id,status FROM data_versions WHERE period=?", (period,)
            )
        }
        self.assertEqual(statuses[first["id"]], "archived")
        self.assertEqual(statuses[second["id"]], "published")
        self.assertEqual(
            self.db.fetch_one(
                """SELECT COUNT(*) AS total FROM data_versions
                   WHERE period=? AND status='published'""",
                (period,),
            )["total"],
            1,
        )

    def test_event_sequences_are_unique_and_continuous_under_concurrency(self):
        from backend import data_versions

        version_id = "postgres-event-sequence-test"
        actor = data_versions.Actor(user_id="postgres-test", role="admin")
        timestamp = "2099-01-01T00:00:00+00:00"
        self.db.execute(
            "DELETE FROM data_version_events WHERE data_version_id=?",
            (version_id,),
        )
        self.db.execute("DELETE FROM data_versions WHERE id=?", (version_id,))
        self.db.execute(
            """INSERT INTO data_versions
            (id,period,status,schema_version,payload,payload_size,sha256,
             validation_report,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                version_id, "2099-02", "draft", "data-version-v1", "{}", 2,
                "postgres-event-sequence-test-hash", None, "postgres-test",
                timestamp, timestamp,
            ),
        )
        barrier = threading.Barrier(6)
        errors = []

        def write_event(index):
            try:
                barrier.wait(timeout=5)
                with self.db.transaction() as tx:
                    data_versions._event(
                        tx, version_id, f"postgres_{index}", actor,
                        from_status="draft", to_status="draft",
                    )
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=write_event, args=(index,)) for index in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
        self.assertFalse(errors, errors)
        sequences = [
            row["event_sequence"]
            for row in self.db.fetch_all(
                """SELECT event_sequence FROM data_version_events
                   WHERE data_version_id=? ORDER BY event_sequence ASC""",
                (version_id,),
            )
        ]
        self.assertEqual(sequences, list(range(1, 7)))
        self.db.execute(
            "DELETE FROM data_version_events WHERE data_version_id=?",
            (version_id,),
        )
        self.db.execute("DELETE FROM data_versions WHERE id=?", (version_id,))
    def test_transaction_rollback(self):
        marker = "postgres-rollback-marker"
        with self.assertRaises(RuntimeError):
            with self.db.transaction() as tx:
                tx.execute(
                    """INSERT INTO audit_logs
                    (id,action,status,user_id,role,details,created_at)
                    VALUES (?,?,?,?,?,?,?)""",
                    (
                        marker, "postgres.rollback", "started", "test",
                        "admin", "{}", "2099-01-01T00:00:00+00:00",
                    ),
                )
                raise RuntimeError("force rollback")
        self.assertIsNone(
            self.db.fetch_one("SELECT id FROM audit_logs WHERE id=?", (marker,))
        )

