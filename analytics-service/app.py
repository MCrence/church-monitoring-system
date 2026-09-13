import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Church Monitoring Analytics")


class PredictionRequest(BaseModel):
    frequency: float = Field(ge=0)
    regularity: float = Field(ge=0, le=1)
    recency_days: float = Field(ge=0)


@app.post("/predict")
def predict(request: PredictionRequest):
    """Return a deterministic baseline until a trained LightGBM model is supplied."""
    score = max(0.0, min(100.0, request.recency_days * 2 - request.frequency * 5 + (1 - request.regularity) * 40))
    return {"risk_score": round(score, 2), "model_version": "baseline-v1"}


@app.get("/health")
def health():
    return {"status": "ok", "model": os.getenv("MODEL_PATH", "baseline")}