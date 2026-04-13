import os
import sys

# Ensure src/ is importable when uvicorn starts the app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI

app = FastAPI(title="Talent Processor", version="0.1.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
