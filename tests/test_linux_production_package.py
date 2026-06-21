import re
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "compose.production.yml"


class LinuxProductionPackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = COMPOSE.read_text(encoding="utf-8")
        cls.compose = yaml.safe_load(cls.text)
        cls.services = cls.compose["services"]

    def test_only_caddy_exposes_public_ports(self):
        public_bindings = []
        for name, service in self.services.items():
            for port in service.get("ports", []):
                value = str(port)
                if not value.startswith("127.0.0.1:"):
                    public_bindings.append((name, value))
        self.assertEqual(
            public_bindings,
            [("caddy", "80:80"), ("caddy", "443:443"), ("caddy", "443:443/udp")],
        )
        self.assertNotIn("ports", self.services["db"])
        self.assertNotIn("ports", self.services["app"])
        self.assertEqual(
            self.services["admin-gateway"]["ports"],
            ["127.0.0.1:${ADMIN_GATEWAY_PORT:-8080}:8080"],
        )
        self.assertNotIn("ports", self.services["public-gateway"])

    def test_restart_healthchecks_and_health_dependencies(self):
        for name, service in self.services.items():
            self.assertEqual(service.get("restart"), "unless-stopped", name)
        for name in ("db", "app", "public-gateway"):
            self.assertIn("healthcheck", self.services[name], name)
        self.assertEqual(
            self.services["app"]["depends_on"]["db"]["condition"],
            "service_healthy",
        )
        self.assertEqual(
            self.services["public-gateway"]["depends_on"]["app"]["condition"],
            "service_healthy",
        )
        self.assertEqual(
            self.services["caddy"]["depends_on"]["public-gateway"]["condition"],
            "service_healthy",
        )

    def test_postgres_and_caddy_use_named_volumes(self):
        self.assertIn("postgres_data:/var/lib/postgresql/data", self.services["db"]["volumes"])
        self.assertIn("caddy_data:/data", self.services["caddy"]["volumes"])
        self.assertIn("caddy_config:/config", self.services["caddy"]["volumes"])

    def test_public_route_allowlist_is_not_expanded(self):
        nginx = (ROOT / "ops/public-nginx.conf").read_text(encoding="utf-8")
        caddy = (ROOT / "ops/caddy/Caddyfile").read_text(encoding="utf-8")
        for required in (
            "^/share/[^/]+$", "^/api/shared-data/[^/]+$",
            "^/dashboard-[A-Za-z0-9_-]+\\.js$",
            "/dashboard-diagnosis.css", "/dashboard-publish.css",
            "/chart.umd.min.js", "/xlsx.full.min.js",
            "/pages/crypto.js", "/pages/unlock.js", "/pages/unlock.css",
        ):
            self.assertIn(required, nginx + caddy)
        for forbidden in ("/api/me", "/api/data-versions", "/api/share-links", "/save-backup"):
            self.assertNotIn("reverse_proxy " + forbidden, caddy)
        self.assertIn('respond "Not Found" 404', caddy)
        self.assertIn("return 404", nginx)
        self.assertIn("GET|HEAD", nginx)

    def test_security_controls_and_token_safe_logs(self):
        nginx = (ROOT / "ops/public-nginx.conf").read_text(encoding="utf-8")
        caddy = (ROOT / "ops/caddy/Caddyfile").read_text(encoding="utf-8")
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn("limit_req_zone", nginx)
        self.assertIn("client_max_body_size 1m", nginx)
        self.assertIn("Content-Security-Policy", nginx)
        self.assertIn("Strict-Transport-Security", caddy)
        self.assertIn("max_size 1MB", caddy)
        self.assertNotIn("log {", caddy)
        self.assertNotIn("$request_uri", nginx)
        self.assertNotIn('"$request"', nginx)
        self.assertIn("--no-access-log", dockerfile)

    def test_backup_restore_and_deploy_safety(self):
        deploy = (ROOT / "ops/scripts/deploy.sh").read_text(encoding="utf-8")
        backup = (ROOT / "ops/scripts/backup.sh").read_text(encoding="utf-8")
        restore = (ROOT / "ops/scripts/restore.sh").read_text(encoding="utf-8")
        for script in (deploy, backup, restore):
            self.assertIn("set -Eeuo pipefail", script)
            self.assertNotRegex(script, r"(?i)echo.*(POSTGRES_PASSWORD|PROXY_SHARED_SECRET)")
            self.assertNotIn("set -x", script)

        self.assertIn('mktemp "$BACKUP_DIR/.diagnosis_', backup)
        self.assertIn('trap cleanup EXIT', backup)
        self.assertIn('rm -f -- "$temporary"', backup)
        self.assertIn('> "$temporary"', backup)
        self.assertIn('[[ ! -s "$temporary" ]]', backup)
        self.assertIn('mv -f -- "$temporary" "$filename"', backup)
        self.assertLess(backup.index('> "$temporary"'), backup.index('mv -f --'))
        self.assertLess(backup.index('[[ ! -s "$temporary" ]]'), backup.index('mv -f --'))
        self.assertIn("-mtime +6 -delete", backup)

        self.assertIn("Type RESTORE to continue", restore)
        self.assertIn('backup_output="$("$ROOT_DIR/ops/scripts/backup.sh")"', restore)
        self.assertIn('pre_restore_backup="${backup_output#Backup created: }"', restore)
        self.assertIn('application_services=(app admin-gateway public-gateway caddy)', restore)
        self.assertIn('trap finish EXIT', restore)
        self.assertIn('services_stopped=1', restore)
        self.assertIn('"${compose[@]}" stop "${application_services[@]}"', restore)
        self.assertIn('"${compose[@]}" up -d "${application_services[@]}"', restore)
        for option in (
            "--clean", "--if-exists", "--exit-on-error", "--single-transaction",
            "--no-owner", "--no-acl",
        ):
            self.assertIn(option, restore)
        self.assertIn('"$ROOT_DIR/ops/scripts/healthcheck.sh"', restore)
        self.assertIn("RESTORE FAILED", restore)
        self.assertIn("Use the pre-restore backup to roll back", restore)
        self.assertLess(restore.index("backup_output="), restore.index(' stop "${application_services[@]}"'))
        self.assertLess(restore.index(' stop "${application_services[@]}"'), restore.index("pg_restore"))
        self.assertLess(restore.index("pg_restore"), restore.rindex(' up -d "${application_services[@]}"'))
        self.assertLess(restore.rindex(' up -d "${application_services[@]}"'), restore.index("healthcheck.sh"))

        self.assertIn("config --quiet", deploy)
        self.assertIn("healthcheck.sh", deploy)
        self.assertIn("POSTGRES_PASSWORD is weak", deploy)
        self.assertIn("PROXY_SHARED_SECRET is weak", deploy)

    def test_systemd_daily_backup_timer_and_documentation(self):
        service = (ROOT / "ops/systemd/anxiaoneng-backup.service").read_text(
            encoding="utf-8"
        )
        timer = (ROOT / "ops/systemd/anxiaoneng-backup.timer").read_text(
            encoding="utf-8"
        )
        documentation = (ROOT / "ops/DEPLOYMENT.md").read_text(encoding="utf-8")
        self.assertIn("Type=oneshot", service)
        self.assertIn("ExecStart=/usr/bin/bash /opt/anxiaoneng/ops/scripts/backup.sh", service)
        self.assertIn("Environment=ENV_FILE=/opt/anxiaoneng/.env.production", service)
        self.assertIn("ReadWritePaths=-/opt/anxiaoneng/backups", service)
        self.assertIn("OnCalendar=*-*-* 02:20:00", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("WantedBy=timers.target", timer)
        for command in (
            "systemctl enable --now anxiaoneng-backup.timer",
            "systemctl status anxiaoneng-backup.timer",
            "systemctl status anxiaoneng-backup.service",
            "journalctl -u anxiaoneng-backup.service",
        ):
            self.assertIn(command, documentation)
    def test_examples_and_configs_contain_no_real_credentials(self):
        example = (ROOT / ".env.production.example").read_text(encoding="utf-8")
        self.assertIn("replace-with-at-least-24-random-characters", example)
        self.assertIn("replace-with-at-least-32-random-characters", example)
        checked = [
            COMPOSE, ROOT / ".env.production.example", ROOT / "ops/caddy/Caddyfile",
            *sorted((ROOT / "ops/scripts").glob("*.sh")),
        ]
        content = "\n".join(path.read_text(encoding="utf-8") for path in checked)
        self.assertNotRegex(content, r"(?i)(sk-[A-Za-z0-9_-]{16,}|[0-9a-f]{32}\.[A-Za-z0-9]{16,})")
        config_content = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (COMPOSE, ROOT / ".env.production.example", ROOT / "ops/caddy/Caddyfile")
        )
        self.assertNotIn("change-me", config_content)
        self.assertNotIn("test-only-postgres-password", content)
        self.assertRegex(self.text, r"\$\{POSTGRES_PASSWORD:\?POSTGRES_PASSWORD is required\}")
        self.assertRegex(self.text, r"\$\{PROXY_SHARED_SECRET:\?PROXY_SHARED_SECRET is required\}")


if __name__ == "__main__":
    unittest.main()
