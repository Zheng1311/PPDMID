"""Optional lightweight service for the PPD-MID frontend.

The agricultural conversation is intentionally handled by Dify directly from the
frontend. This module remains only as a minimal health endpoint for future
server-side integrations; it contains no model orchestration logic.
"""

from fastapi import FastAPI

app = FastAPI(title="PPD-MID 安徽版 API", version="0.2.0")


@app.get("/api/v1/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "region": "安徽省",
        "conversation_provider": "dify-direct-frontend",
    }
