import unittest

from backend.domain import (
    classify_review,
    next_task_state,
    validate_interpretation,
    validate_task_fields,
)


class TaskStateTests(unittest.TestCase):
    def test_state_machine_allows_only_next_state(self):
        self.assertEqual(next_task_state("draft", "confirmed"), "confirmed")
        with self.assertRaises(ValueError):
            next_task_state("draft", "in_progress")
        with self.assertRaises(ValueError):
            next_task_state("closed", "closed")

    def test_confirmation_requires_owner_action_and_due_date(self):
        with self.assertRaises(ValueError):
            validate_task_fields({"action": "核查"}, "confirmed")
        validate_task_fields(
            {
                "action": "核查",
                "owner_department": "理赔部",
                "owner_name": "测试用户",
                "due_date": "2026-07-01",
            },
            "confirmed",
        )


class ReviewTests(unittest.TestCase):
    def test_lower_metric_improvement(self):
        result = classify_review(1.10, 0.95, "decrease", 1.00)
        self.assertEqual(result["result"], "明显改善")
        self.assertTrue(result["targetMet"])

    def test_missing_data(self):
        self.assertEqual(classify_review(1.0, None)["result"], "数据不足")

    def test_increase_direction(self):
        result = classify_review(100, 115, "increase", 110)
        self.assertEqual(result["result"], "明显改善")
        self.assertAlmostEqual(result["changeRatio"], 0.15)
        self.assertTrue(result["targetMet"])

    def test_target_direction_uses_distance(self):
        result = classify_review(80, 95, "target", 100)
        self.assertEqual(result["result"], "明显改善")
        self.assertEqual(result["previousTargetDistance"], 20)
        self.assertEqual(result["currentTargetDistance"], 5)
        self.assertEqual(result["targetDistanceChange"], 15)

    def test_neutral_direction_does_not_claim_improvement(self):
        result = classify_review(100, 130, "neutral")
        self.assertEqual(result["result"], "中性监测")
        self.assertIsNone(result["improvement"])


class InterpretationTests(unittest.TestCase):
    def setUp(self):
        self.evidence = [{
            "id": "ev_1",
            "current_value": 1.05,
            "benchmark_value": 0.98,
            "difference_value": 0.07,
        }]

    def test_accepts_evidence_bound_fact(self):
        payload = {
            "summary": "综合成本率需要关注",
            "facts": [{"text": "综合成本率为105%", "evidenceId": "ev_1", "currentValue": 1.05}],
            "inferences": [],
            "investigations": [],
            "recommendations": [],
            "limitations": [],
        }
        self.assertEqual(validate_interpretation(payload, self.evidence), payload)

    def test_rejects_unbound_number(self):
        payload = {
            "summary": "综合成本率为137%",
            "facts": [{"text": "综合成本率为105%", "evidenceId": "ev_1", "currentValue": 1.05}],
            "inferences": [],
            "investigations": [],
            "recommendations": [],
            "limitations": [],
        }
        with self.assertRaises(ValueError):
            validate_interpretation(payload, self.evidence)


if __name__ == "__main__":
    unittest.main()
