import json
import unittest
from pathlib import Path


class RegressionFixtureTests(unittest.TestCase):
    def test_contains_at_least_sixty_unique_cases(self):
        fixture_dir = Path(__file__).parent / "fixtures"
        cases = []
        for name in ("ai_regression_cases.json", "agent_regression_cases.json"):
            cases.extend(json.loads((fixture_dir / name).read_text(encoding="utf-8")))
        self.assertGreaterEqual(len(cases), 60)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for case in cases:
            self.assertTrue(case["scenario"])
            self.assertIsInstance(case["inputSnapshot"], dict)
            self.assertTrue(case["allowedConclusions"])
            self.assertTrue(case["forbiddenConclusions"])
            self.assertIsInstance(case["requiredEvidence"], list)
            self.assertTrue(case["expectedRecommendations"])


if __name__ == "__main__":
    unittest.main()
