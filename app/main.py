"""HTTP API and static UI for xper_mDm."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .generator import Generator, InputError, Request, deck_view
from .scryfall import CardDataError, Scryfall

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="xper_mDm — Commander Deck Forge", version="0.1.0")
source = Scryfall()
builder = Generator(source)


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    colors: list[str] = Field(default_factory=list, max_length=5)
    creature_types: list[str] = Field(default_factory=list, max_length=3)
    keywords: list[str] = Field(default_factory=list, max_length=5)
    commander: str = Field(default="", max_length=150)
    favorites: list[str] = Field(default_factory=list, max_length=5)
    options: int = Field(default=4, ge=1, le=4)


@app.post("/api/generate")
def generate(payload: GenerateInput):
    try:
        request = Request(**payload.model_dump())
        decks = builder.generate(request)
        return {"decks": [deck_view(deck) for deck in decks], "source": "Scryfall live Commander legality",
                "quality_note": "Quality ratings are heuristic, not playtested win rates."}
    except InputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CardDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
