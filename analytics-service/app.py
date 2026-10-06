from fastapi import FastAPI
from pydantic import BaseModel, Field

from risk_scoring import score_attendance_risk

app = FastAPI(title="Church Monitoring Analytics")


class PredictionRequest(BaseModel):
    attendance_weeks: float = Field(ge=0, allow_inf_nan=False)
    recency_days: float = Field(ge=0, allow_inf_nan=False)


@app.post("/predict")
def predict(request: PredictionRequest):
    """Return a transparent attendance indicator, not a validated prediction."""
    score = score_attendance_risk(request.attendance_weeks, request.recency_days)
    return {
        "risk_score": score,
        "model_version": "attendance-baseline-v2",
        "model_type": "rule_based_heuristic",
        "validated": False,
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "attendance-baseline-v2",
        "model_type": "rule_based_heuristic",
        "validated": False,
    }