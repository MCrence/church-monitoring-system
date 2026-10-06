import math
import unittest

from risk_scoring import score_attendance_risk


class AttendanceRiskScoringTests(unittest.TestCase):
    def test_no_recent_attendance_has_maximum_indicator(self):
        self.assertEqual(score_attendance_risk(0, 90), 100)

    def test_regular_recent_attendance_has_low_indicator(self):
        self.assertEqual(score_attendance_risk(13, 0), 0)

    def test_score_is_bounded_and_uses_cap_values(self):
        self.assertEqual(score_attendance_risk(26, 100), 50)

    def test_rejects_negative_or_non_finite_inputs(self):
        for attendance_weeks, recency_days in ((-1, 0), (0, -1), (math.inf, 1), (1, math.nan)):
            with self.subTest(attendance_weeks=attendance_weeks, recency_days=recency_days):
                with self.assertRaises(ValueError):
                    score_attendance_risk(attendance_weeks, recency_days)


if __name__ == "__main__":
    unittest.main()
