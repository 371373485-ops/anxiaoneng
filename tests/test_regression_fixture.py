import json
import unittest
from pathlib import Path

from backend.evaluation_dataset import (
    BLIND_SET_VERSION,
    DATASET_VERSION,
    merge_evaluation_cases,
)

class RegressionFixtureTests(unittest.TestCase):
    def test_contains_at_least_two_hundred_unique_cases(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        cases = []
        for name in ("ai_regression_cases.json", "agent_regression_cases.json"):
            cases.extend(json.loads((fixture_dir / name).read_text(encoding="utf-8")))
        cases = merge_evaluation_cases(cases)
        self.assertGreaterEqual(len(cases), 200)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for case in cases:
            self.assertTrue(case["scenario"])
            self.assertIsInstance(case["inputSnapshot"], dict)
            self.assertTrue(case["allowedConclusions"])
            self.assertTrue(case["forbiddenConclusions"])
            self.assertIsInstance(case["requiredEvidence"], list)
            self.assertTrue(case["expectedRecommendations"])

    def test_reliability_dataset_has_blind_cases_and_version(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        base = []
        for name in ("ai_regression_cases.json", "agent_regression_cases.json"):
            base.extend(json.loads((fixture_dir / name).read_text(encoding="utf-8")))
        cases = merge_evaluation_cases(base)
        generated = [case for case in cases if case["id"].startswith("R")]
        self.assertTrue(all(case["datasetVersion"] == DATASET_VERSION for case in generated))
        blind = [case for case in cases if case.get("blind")]
        self.assertGreaterEqual(len(blind) / len(cases), 0.30)
        self.assertGreaterEqual(len(blind), 60)
        self.assertEqual(BLIND_SET_VERSION, "reliability-blind-v1")

    def test_generated_cases_have_required_classification_fields(self):
        cases = merge_evaluation_cases([])
        categories = {case["category"] for case in cases}
        expected_categories = {
            "numeric", "unit", "evidence", "cross_org", "direction",
            "relevance", "specificity", "causality", "injection",
            "missing_input", "provider_error", "schema", "remediation",
            "memory",
        }
        self.assertEqual(categories, expected_categories)
        for case in cases:
            self.assertIn(case["riskLevel"], {"high", "critical"})
            self.assertIn(case["runtimeMode"], {"admin_ai", "share_local"})
            self.assertIsInstance(case["requiredMetrics"], list)
            self.assertIsInstance(case["expectedToolSteps"], list)
            self.assertIsInstance(case["expectedBlockers"], list)
            self.assertIsInstance(case["evaluationFocus"], list)
            self.assertIsInstance(case["tags"], list)
            self.assertIn("generated", case["tags"])


if __name__ == "__main__":
    unittest.main()
