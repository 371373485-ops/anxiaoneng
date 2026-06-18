import tempfile
import unittest
from pathlib import Path

from backend import agent_runtime, db
from backend.domain import now_iso


class AgentRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        db.DATABASE_URL = "sqlite:///" + str(Path(self.tempdir.name) / "agent.db")
        db.init_db()
        timestamp = now_iso()
        db.execute(
            """INSERT INTO organizations
            (org_id,org_code,org_type,name,normalized_name,parent_org_id,
             active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            ("BR_A", "BR_A", "branch", "A分公司", "a分公司", None, 1, timestamp, timestamp),
        )
        db.execute(
            """INSERT INTO evidence
            (id,diagnosis_id,org_id,branch,period,metric,label,metric_id,direction,
             benchmark_type,benchmark_label,calculation_version,current_value,
             benchmark_value,difference_value,unit,source,rule_id,payload,created_by,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "ev_1", "diag_1", "BR_A", "A分公司", "2026-06", "costRate",
                "综合成本率", "M_COST", "decrease", "overall", "整体",
                "calc-v1", 0.95, 1.0, -0.05, "%", "test", None, "{}", "tester", timestamp,
            ),
        )

    def tearDown(self):
        self.tempdir.cleanup()

    def test_create_run_executes_whitelisted_tools(self):
        result = agent_runtime.create_run({
            "goal": "分析综合成本率",
            "orgId": "BR_A", "branch": "A分公司", "period": "2026-06",
            "metricIds": ["M_COST"], "taskType": "analysis",
            "idempotencyKey": "agent-test-1",
        }, "tester")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["steps"]), 4)
        self.assertEqual(result["result"]["facts"][0]["value"], 0.95)
        self.assertTrue(result["validationReport"]["passed"])
        self.assertEqual(
            result["steps"][0]["output"]["source"], "evidence_snapshot"
        )

    def test_idempotency_returns_same_run(self):
        payload = {
            "goal": "分析综合成本率",
            "orgId": "BR_A", "branch": "A分公司", "period": "2026-06",
            "idempotencyKey": "same-run",
        }
        first = agent_runtime.create_run(payload, "tester")
        second = agent_runtime.create_run(payload, "tester")
        self.assertEqual(first["id"], second["id"])

    def test_missing_period_waits_and_can_resume(self):
        result = agent_runtime.create_run({
            "goal": "分析综合成本率", "orgId": "BR_A", "branch": "A分公司",
            "idempotencyKey": "waiting-run",
        }, "tester")
        self.assertEqual(result["status"], "waiting_user")
        resumed = agent_runtime.add_inputs(
            result["id"], {"period": "2026-06", "metricIds": ["M_COST"]}, "tester"
        )
        self.assertEqual(resumed["status"], "completed")

    def test_cancel_waiting_run(self):
        result = agent_runtime.create_run({
            "goal": "分析综合成本率", "idempotencyKey": "cancel-run",
        }, "tester")
        cancelled = agent_runtime.cancel_run(result["id"])
        self.assertEqual(cancelled["status"], "cancelled")

    def test_high_risk_result_waits_for_human_review(self):
        result = agent_runtime.create_run({
            "goal": "分析综合成本率",
            "orgId": "BR_A", "branch": "A分公司", "period": "2026-06",
            "metricIds": ["M_COST"], "riskLevel": "high",
            "validationPolicy": "strict", "idempotencyKey": "high-risk",
        }, "tester")
        self.assertEqual(result["status"], "human_review_required")
        self.assertTrue(result["validationReport"]["requiresHumanReview"])


if __name__ == "__main__":
    unittest.main()
