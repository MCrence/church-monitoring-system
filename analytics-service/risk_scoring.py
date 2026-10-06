import math


def score_attendance_risk(attendance_weeks: float, recency_days: float) -> float:
    if not math.isfinite(attendance_weeks) or attendance_weeks < 0:
        raise ValueError("attendance_weeks must be a finite non-negative number")
    if not math.isfinite(recency_days) or recency_days < 0:
        raise ValueError("recency_days must be a finite non-negative number")

    attendance_coverage = min(attendance_weeks / 13, 1)
    inactivity = min(recency_days / 45, 1)
    return round(50 * (1 - attendance_coverage) + 50 * inactivity, 2)
