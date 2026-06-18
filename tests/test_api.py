import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None
HAS_HTTPX = importlib.util.find_spec("httpx") is not None


@unittest.skipUnless(HAS_FASTAPI and HAS_HTTPX, "requires backend dev dependencies")
class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory()
        os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(cls.tempdir.name) / "api.db")
        os.environ["AI_ENABLED"] = "false"
        from fastapi.testclient import TestClient
        from backend import app as app_module
        app_module.db.DATABASE_URL = os.environ["DATABASE_URL"]
        app_module.db.init_db()
        cls.client = TestClient(app_module.app)
        cls.headers = {
            "X-User-Id": "tester", "X-Role": "admin", "X-Branches": "*",
        }

    @classmethod
    def tearDownClass(cls):
        cls.tempdir.cleanup()

    def test_diagnosis_and_evidence_contract(self):
        payload = {
            "branch": "测试分公司", "period": "2026-06",
            "dataVersion": "data-1", "ruleVersion": "rules-1",
            "riskLevel": "中风险", "summary": "测试摘要",
            "facts": [], "inferences": [], "investigations": [],
            "recommendations": [], "limitations": [],
            "evidence": [{
                "id": "ev_api_1", "metric": "已赚赔付率实际",
                "label": "赔付率", "currentValue": 0.72,
                "benchmarkValue": 0.65, "differenceValue": 0.07,
                "unit": "%", "source": "test",
            }],
        }
        response = self.client.post("/api/diagnoses", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        diagnosis_id = response.json()["id"]
        evidence = self.client.get("/api/evidence/ev_api_1", headers=self.headers)
        self.assertEqual(evidence.status_code, 200)
        self.assertEqual(evidence.json()["diagnosis_id"], diagnosis_id)
        self.assertTrue(response.json()["orgId"].startswith("BR_"))

    def test_organizations_endpoint_and_org_id_name_validation(self):
        organizations = self.client.get("/api/organizations", headers=self.headers)
        self.assertEqual(organizations.status_code, 200)
        self.assertTrue(any(item["name"] == "测试分公司" for item in organizations.json()))
        mismatch = self.client.post(
            "/api/diagnoses",
            json={
                "orgId": next(
                    item["orgId"] for item in organizations.json()
                    if item["name"] == "测试分公司"
                ),
                "branch": "另一家分公司", "period": "2026-06",
                "dataVersion": "mismatch", "ruleVersion": "rules-1",
                "riskLevel": "关注", "summary": "测试",
                "facts": [], "inferences": [], "investigations": [],
                "recommendations": [], "limitations": [], "evidence": [],
            },
            headers=self.headers,
        )
        self.assertEqual(mismatch.status_code, 422)

    def test_metric_key_cannot_be_rebound_to_another_metric_id(self):
        first = self.client.post(
            "/api/diagnoses",
            json={
                "branch": "指标口径测试一", "period": "2026-06",
                "dataVersion": "metric-v1", "ruleVersion": "rules-1",
                "riskLevel": "关注", "summary": "测试", "facts": [],
                "inferences": [], "investigations": [], "recommendations": [],
                "limitations": [], "evidence": [{
                    "metric": "stableMetricKey", "metricId": "M_STABLE_1",
                    "label": "稳定指标", "currentValue": 1, "unit": "万元",
                    "source": "test", "direction": "increase",
                }],
            },
            headers=self.headers,
        )
        self.assertEqual(first.status_code, 200, first.text)
        conflict = self.client.post(
            "/api/diagnoses",
            json={
                "branch": "指标口径测试二", "period": "2026-06",
                "dataVersion": "metric-v2", "ruleVersion": "rules-1",
                "riskLevel": "关注", "summary": "测试", "facts": [],
                "inferences": [], "investigations": [], "recommendations": [],
                "limitations": [], "evidence": [{
                    "metric": "stableMetricKey", "metricId": "M_STABLE_2",
                    "label": "稳定指标", "currentValue": 1, "unit": "万元",
                    "source": "test", "direction": "increase",
                }],
            },
            headers=self.headers,
        )
        self.assertEqual(conflict.status_code, 422, conflict.text)

    def test_proxy_auth_ignores_browser_supplied_development_identity(self):
        from backend import app as app_module
        with patch.object(app_module, "AUTH_MODE", "proxy"):
            forged = self.client.get(
                "/api/organizations",
                headers={
                    "X-User-Id": "forged-admin",
                    "X-Role": "admin",
                    "X-Branches": "*",
                },
            )
            trusted = self.client.get(
                "/api/organizations",
                headers={
                    "X-User-Id": "forged-admin",
                    "X-Role": "admin",
                    "X-Branches": "*",
                    "X-Authenticated-User": "gateway-user",
                    "X-Authenticated-Role": "admin",
                    "X-Authenticated-Branches": "*",
                },
            )
        self.assertEqual(forged.status_code, 401)
        self.assertEqual(trusted.status_code, 200)

    def test_admin_audit_query_records_filters(self):
        from backend import app as app_module
        response = self.client.get(
            "/api/audit-logs?branch=测试分公司&period=2026-06&status=success&limit=20",
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        record = app_module.db.fetch_one(
            "SELECT * FROM audit_logs WHERE action=? ORDER BY created_at DESC",
            ("audit.query",),
        )
        details = app_module.db.load(record["details"], {})
        self.assertEqual(details["filters"]["branch"], "测试分公司")
        self.assertEqual(details["filters"]["limit"], 20)

    def test_interpretation_degrades_when_ai_disabled(self):
        payload = {
            "branch": "降级分公司", "period": "2026-06",
            "dataVersion": "data-2", "ruleVersion": "rules-1",
            "riskLevel": "关注", "summary": "规则报告可用",
            "facts": [], "inferences": [], "investigations": [],
            "recommendations": [], "limitations": [], "evidence": [],
        }
        diagnosis = self.client.post("/api/diagnoses", json=payload, headers=self.headers).json()
        response = self.client.post(
            f"/api/diagnoses/{diagnosis['id']}/interpretations",
            json={}, headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["degraded"])
        self.assertEqual(response.json()["degradeReason"], "closed")

    def test_evaluation_run_records_closed_ai_fallback(self):
        response = self.client.post(
            "/api/evaluations/run",
            json={"cases": [{
                "id": "E01", "inputSnapshot": {"scenario": "AI关闭"},
                "allowedConclusions": ["规则诊断可用"],
                "forbiddenConclusions": ["生成式结论"],
                "requiredEvidence": [], "expectedRecommendations": [],
            }]},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        run = response.json()
        self.assertFalse(run["gatePassed"])
        self.assertEqual(run["metrics"]["fallbackSuccessRate"], 1.0)
        detail = self.client.get(
            f"/api/evaluations/{run['id']}", headers=self.headers
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["cases"][0]["errorType"], "closed")
        self.assertTrue(detail.json()["cases"][0]["fallbackSuccess"])

    def test_interpretation_retries_once_after_format_error(self):
        from backend import app as app_module
        payload = {
            "branch": "重试测试分公司", "period": "2026-06",
            "dataVersion": "retry-data", "ruleVersion": "rules-1",
            "riskLevel": "关注", "summary": "规则报告",
            "facts": [], "inferences": [], "investigations": [],
            "recommendations": [], "limitations": [], "evidence": [],
        }
        diagnosis = self.client.post(
            "/api/diagnoses", json=payload, headers=self.headers
        ).json()
        valid = {
            "summary": "规则证据范围内结论", "facts": [], "inferences": [],
            "investigations": [], "recommendations": [], "limitations": [],
        }
        with (
            patch.object(app_module, "AI_ENABLED", True),
            patch.object(app_module, "AI_KEY", "test-key"),
            patch.object(
                app_module, "ai_request",
                side_effect=[("not-json", {}), (app_module.db.dump(valid), {})],
            ) as mocked,
        ):
            response = self.client.post(
                f"/api/diagnoses/{diagnosis['id']}/interpretations",
                json={}, headers=self.headers,
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json().get("degraded", False))
        self.assertEqual(mocked.call_count, 2)

    def test_interpretation_degrades_after_two_validation_failures(self):
        from backend import app as app_module
        payload = {
            "branch": "连续失败分公司", "period": "2026-06",
            "dataVersion": "fallback-data", "ruleVersion": "rules-1",
            "riskLevel": "关注", "summary": "规则报告仍可用",
            "facts": [], "inferences": [], "investigations": [],
            "recommendations": [], "limitations": [], "evidence": [],
        }
        diagnosis = self.client.post(
            "/api/diagnoses", json=payload, headers=self.headers
        ).json()
        with (
            patch.object(app_module, "AI_ENABLED", True),
            patch.object(app_module, "AI_KEY", "test-key"),
            patch.object(
                app_module, "ai_request",
                side_effect=[("not-json", {}), ("still-not-json", {})],
            ) as mocked,
        ):
            response = self.client.post(
                f"/api/diagnoses/{diagnosis['id']}/interpretations",
                json={}, headers=self.headers,
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["degraded"])
        self.assertEqual(response.json()["degradeReason"], "format_error")
        self.assertEqual(mocked.call_count, 2)

    def test_task_direction_history_and_review_are_metadata_driven(self):
        initial = {
            "schemaVersion": "diagnosis-v2", "orgId": "BR_TEST",
            "branch": "整改测试分公司", "period": "2026-05",
            "dataVersion": "task-data-1", "ruleVersion": "rules-1",
            "riskLevel": "关注", "summary": "测试",
            "facts": [], "inferences": [], "investigations": [],
            "recommendations": [{
                "id": "rec_cost", "title": "成本改善", "metric": "综合成本率",
                "metricId": "M_COST", "direction": "decrease",
            }],
            "limitations": [],
            "evidence": [{
                "id": "ev_task_1", "metric": "综合成本率", "metricId": "M_COST",
                "label": "综合成本率", "currentValue": 1.10,
                "benchmarkValue": 1.00, "differenceValue": 0.10,
                "unit": "%", "source": "test", "direction": "decrease",
                "benchmarkType": "weightedOverall", "calculationVersion": "calc-v1",
                "rank": 20,
            }],
        }
        diagnosis = self.client.post(
            "/api/diagnoses", json=initial, headers=self.headers
        ).json()
        task_response = self.client.post(
            "/api/remediation-tasks",
            json={
                "diagnosisId": diagnosis["id"], "recommendationIndex": 0,
                "sourceRecommendationId": "rec_cost", "metricId": "M_COST",
                "title": "降低综合成本率", "metric": "综合成本率",
                "currentValue": 1.10, "targetValue": 1.00,
            },
            headers=self.headers,
        )
        self.assertEqual(task_response.status_code, 200, task_response.text)
        task = task_response.json()
        self.assertEqual(task["direction"], "decrease")
        self.assertEqual(task["sourceRecommendationId"], "rec_cost")

        patch = self.client.patch(
            f"/api/remediation-tasks/{task['id']}",
            json={
                "status": "confirmed", "action": "逐项核查",
                "ownerDepartment": "经营管理部", "ownerName": "测试人",
                "dueDate": "2026-07-01",
            },
            headers=self.headers,
        )
        self.assertEqual(patch.status_code, 200, patch.text)

        followup = dict(initial)
        followup.update({"period": "2026-06", "dataVersion": "task-data-2"})
        followup["evidence"] = [dict(initial["evidence"][0], **{
            "id": "ev_task_2", "currentValue": 0.95,
            "benchmarkValue": 0.98, "differenceValue": -0.03, "rank": 8,
        })]
        followup_diagnosis = self.client.post(
            "/api/diagnoses", json=followup, headers=self.headers
        ).json()
        review = self.client.post(
            f"/api/remediation-tasks/{task['id']}/reviews",
            json={"diagnosisId": followup_diagnosis["id"]},
            headers=self.headers,
        )
        self.assertEqual(review.status_code, 200, review.text)
        result = review.json()
        self.assertAlmostEqual(result["changeValue"], -0.15)
        self.assertAlmostEqual(result["benchmarkChange"], -0.02)
        self.assertEqual(result["rankChange"], 12)

        from backend import app as app_module
        history = app_module.db.fetch_all(
            "SELECT * FROM task_status_history WHERE task_id=? ORDER BY changed_at",
            (task["id"],),
        )
        self.assertEqual([item["to_status"] for item in history], ["draft", "confirmed"])


    def test_agent_run_wait_resume_and_cancel_contract(self):
        waiting = self.client.post(
            "/api/agent-runs",
            json={"goal": "分析本月经营问题", "idempotencyKey": "api-waiting"},
            headers=self.headers,
        )
        self.assertEqual(waiting.status_code, 200, waiting.text)
        self.assertEqual(waiting.json()["status"], "waiting_user")
        cancelled = self.client.post(
            f"/api/agent-runs/{waiting.json()['id']}/cancel",
            json={}, headers=self.headers,
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertEqual(cancelled.json()["status"], "cancelled")

        resumable = self.client.post(
            "/api/agent-runs",
            json={"goal": "分析本月经营问题", "idempotencyKey": "api-resume"},
            headers=self.headers,
        ).json()
        resumed = self.client.post(
            f"/api/agent-runs/{resumable['id']}/inputs",
            json={
                "orgId": "BR_TEST", "branch": "整改测试分公司", "period": "2026-06",
            },
            headers=self.headers,
        )
        self.assertEqual(resumed.status_code, 200, resumed.text)
        self.assertEqual(resumed.json()["status"], "insufficient_evidence")

    def test_agent_tools_memories_and_pilot_metrics(self):
        tools = self.client.get("/api/tools", headers=self.headers)
        self.assertEqual(tools.status_code, 200)
        self.assertGreaterEqual(len(tools.json()["tools"]), 7)

        saved = self.client.post(
            "/api/agent-memories",
            json={
                "orgId": "BR_TEST", "type": "preference", "key": "display",
                "payload": {"detail": "compact", "token": "must-not-persist"},
            },
            headers=self.headers,
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertNotIn("token", saved.json()["payload"])
        memories = self.client.get(
            "/api/agent-memories?orgId=BR_TEST&type=preference",
            headers=self.headers,
        )
        self.assertEqual(memories.status_code, 200)
        self.assertTrue(memories.json())

        metrics = self.client.get("/api/pilot-metrics", headers=self.headers)
        self.assertEqual(metrics.status_code, 200)
        self.assertIn("failureRate", metrics.json())

    def test_agent_run_rejects_cross_org_access(self):
        created = self.client.post(
            "/api/agent-runs",
            json={
                "goal": "分析经营问题", "orgId": "BR_TEST",
                "branch": "整改测试分公司", "period": "2026-06",
                "idempotencyKey": "api-auth",
            },
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200, created.text)
        denied = self.client.get(
            f"/api/agent-runs/{created.json()['id']}",
            headers={"X-User-Id": "branch-user", "X-Role": "branch", "X-Branches": "BR_OTHER"},
        )
        self.assertEqual(denied.status_code, 403)

    def test_shadow_run_is_hidden_and_invalid_output_is_blocked(self):
        diagnosis = self.client.post(
            "/api/diagnoses",
            json={
                "orgId": "BR_SHADOW", "branch": "影子测试分公司",
                "period": "2026-06", "dataVersion": "shadow-data",
                "ruleVersion": "rules-1", "riskLevel": "关注",
                "summary": "影子测试", "facts": [], "inferences": [],
                "investigations": [], "recommendations": [],
                "limitations": [],
                "evidence": [{
                    "id": "ev_shadow", "metric": "costRate",
                    "metricId": "M_SHADOW_COST", "label": "综合成本率",
                    "currentValue": 0.95, "benchmarkValue": 1.0,
                    "differenceValue": -0.05, "unit": "%",
                    "source": "test", "direction": "decrease",
                    "calculationVersion": "calc-v1",
                }],
            },
            headers=self.headers,
        )
        self.assertEqual(diagnosis.status_code, 200, diagnosis.text)
        shadow = self.client.post(
            "/api/shadow-runs",
            json={
                "orgId": "BR_SHADOW", "branch": "影子测试分公司",
                "period": "2026-06", "goal": "分析综合成本率",
                "candidateOutput": {
                    "summary": "综合成本率为1.37。",
                    "facts": [{
                        "id": "fact_shadow", "text": "综合成本率为1.37。",
                        "evidenceIds": ["ev_shadow"],
                        "metricId": "M_SHADOW_COST", "value": 1.37, "unit": "%",
                    }],
                    "inferences": [], "recommendations": [],
                    "limitations": [], "evidenceIds": ["ev_shadow"],
                },
                "model": "shadow-model",
            },
            headers=self.headers,
        )
        self.assertEqual(shadow.status_code, 200, shadow.text)
        self.assertEqual(shadow.json()["status"], "validation_failed")
        self.assertFalse(shadow.json()["visibleToUser"])
        self.assertIn(
            "unsupported_number", shadow.json()["validationReport"]["blockers"]
        )

        disabled_generation = self.client.post(
            "/api/agent-runs/not-configured/shadow-generate",
            json={}, headers=self.headers,
        )
        self.assertEqual(disabled_generation.status_code, 503)

    def test_human_review_and_release_gate_contract(self):
        review = self.client.post(
            "/api/human-reviews",
            json={
                "targetId": "shadow_1", "targetType": "shadow_run",
                "factualScore": 5, "relevanceScore": 4,
                "specificityScore": 4, "actionabilityScore": 4,
                "decision": "approved", "comment": "测试评审",
            },
            headers=self.headers,
        )
        self.assertEqual(review.status_code, 200, review.text)
        self.assertEqual(review.json()["decision"], "approved")

        from backend import app as app_module
        eval_id = "eval_release_gate"
        metrics = {
            "numericAccuracy": 0.995, "evidenceValidityRate": 1.0,
            "organizationIsolationRate": 1.0, "unsupportedFactRate": 0.0,
            "relevanceRate": 0.95, "recommendationCompletenessRate": 0.96,
            "specificityRate": 0.95, "fallbackSuccessRate": 1.0,
            "criticalViolations": 0,
        }
        app_module.db.execute(
            """INSERT INTO evaluation_runs
            (id,status,model,temperature,prompt_version,schema_version,total_cases,
             completed_cases,metrics,gate_passed,created_by,created_at,completed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                eval_id, "completed", "test", 0.0, "p1", "s1", 200, 200,
                app_module.db.dump(metrics), 1, "tester",
                "2026-06-19T00:00:00+00:00", "2026-06-19T00:00:01+00:00",
            ),
        )
        gate = self.client.post(
            "/api/release-gates",
            json={
                "evaluationRunId": eval_id,
                "datasetVersion": "reliability-200-v1",
            },
            headers=self.headers,
        )
        self.assertEqual(gate.status_code, 200, gate.text)
        self.assertTrue(gate.json()["passed"])


if __name__ == "__main__":
    unittest.main()
