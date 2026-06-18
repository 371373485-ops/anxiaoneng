import json
import unittest
from pathlib import Path

from backend.evaluation_dataset import (
    BLIND_SET_VERSION,
    DATASET_VERSION,
    merge_evaluation_cases,
)

class RegressionFixtureTests(unittest.TestCase):
    def test_contains_at_least_sixty_unique_cases(self):
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
        self.assertGreaterEqual(len([case for case in generated if case["blind"]]), 28)
        self.assertEqual(BLIND_SET_VERSION, "reliability-blind-v1")


if __name__ == "__main__":
    unittest.main()
