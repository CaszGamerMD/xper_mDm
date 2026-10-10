"""Small, rate-limited Scryfall adapter. Cards are always revalidated before export."""
from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic, sleep
from typing import Any

import httpx

API = "https://api.scryfall.com"
COLORS = "WUBRG"


class CardDataError(Exception):
    """Scryfall is unavailable, or no usable data was returned."""


@dataclass(frozen=True)
class Card:
    name: str
    oracle_id: str
    type_line: str
    oracle_text: str
    mana_cost: str
    cmc: float
    color_identity: tuple[str, ...]
    legal: bool
    paper: bool
    keywords: tuple[str, ...]
    edhrec_rank: int
    produced_mana: tuple[str, ...]
    image: str
    url: str

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> "Card":
        faces = raw.get("card_faces") or []
        text = raw.get("oracle_text") or "\n".join(f.get("oracle_text", "") for f in faces)
        face_images = next((f.get("image_uris", {}) for f in faces if f.get("image_uris")), {})
        image = raw.get("image_uris") or face_images
        return cls(
            name=raw["name"],
            oracle_id=raw.get("oracle_id") or raw["id"],
            type_line=raw.get("type_line", ""),
            oracle_text=text,
            mana_cost=raw.get("mana_cost") or " // ".join(f.get("mana_cost", "") for f in faces),
            cmc=float(raw.get("cmc", 0)),
            color_identity=tuple(raw.get("color_identity") or []),
            legal=raw.get("legalities", {}).get("commander") == "legal",
            paper="paper" in raw.get("games", []),
            keywords=tuple(raw.get("keywords") or []),
            edhrec_rank=raw.get("edhrec_rank") or 999999,
            produced_mana=tuple(raw.get("produced_mana") or []),
            image=image.get("normal") or image.get("small") or "",
            url=raw.get("scryfall_uri", ""),
        )

    @property
    def land(self) -> bool:
        return "Land" in self.type_line.split(" // ")[0].split(" — ")[0].split()

    @property
    def basic(self) -> bool:
        return self.land and "Basic" in self.type_line.split(" // ")[0].split()

    @property
    def creature(self) -> bool:
        return "Creature" in self.type_line

    @property
    def commander(self) -> bool:
        return ("Legendary" in self.type_line and "Creature" in self.type_line) or "can be your commander" in self.oracle_text.lower()

    @property
    def eligible(self) -> bool:
        return self.legal and self.paper


def identity(colors: tuple[str, ...] | list[str]) -> str:
    return "".join(c for c in COLORS if c in colors) or "C"


class Scryfall:
    """One shared client with a request gap and 24h in-memory cache.

    Deliberately avoids crawling full card inventories: one or two ranked pages
    per search, and collection lookups batched at 75 identifiers.
    """

    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(timeout=22, headers={
            "User-Agent": "xper-mDm-CommanderDeckBuilder/0.1 (github.com/CaszGamerMD/xper_mDm)",
            "Accept": "application/json",
        })
        self.lock = Lock()
        self.last_request = 0.0
        self.cache: dict[str, tuple[float, Any]] = {}

    def _request(self, method: str, path: str, *, params: dict | None = None, json: dict | None = None, not_found_ok: bool = False) -> dict:
        key = repr((method, path, params, json))
        with self.lock:
            cached = self.cache.get(key)
            if cached and monotonic() - cached[0] < 86400:
                return cached[1]
            sleep(max(0, 0.12 - (monotonic() - self.last_request)))
            self.last_request = monotonic()
            try:
                response = self.client.request(method, API + path, params=params, json=json)
                if response.status_code == 404 and not_found_ok:
                    return {}
                if response.status_code in (429, 503):
                    raise CardDataError("Scryfall is rate-limiting requests. Please try again later.")
                response.raise_for_status()
                data = response.json()
            except CardDataError:
                raise
            except (httpx.HTTPError, ValueError) as exc:
                raise CardDataError(f"Unable to load Scryfall card data: {exc}") from exc
            self.cache[key] = (monotonic(), data)
            return data

    def named(self, name: str) -> Card | None:
        data = self._request("GET", "/cards/named", params={"fuzzy": name}, not_found_ok=True)
        return Card.from_api(data) if data.get("object") == "card" else None

    def collection(self, names: list[str]) -> list[Card]:
        results = []
        for i in range(0, len(names), 75):
            batch = names[i:i + 75]
            data = self._request("POST", "/cards/collection", json={"identifiers": [{"name": name} for name in batch]})
            results.extend(Card.from_api(raw) for raw in data.get("data", []))
            if i + 75 < len(names):
                sleep(0.5)  # stricter collection endpoint limit
        return results

    def search(self, query: str, limit: int = 150) -> list[Card]:
        if not query.strip():
            return []
        base = f"legal:commander game:paper {query}"
        seen: dict[str, Card] = {}
        page = 1
        while len(seen) < limit and page <= 2:
            data = self._request("GET", "/cards/search", params={
                "q": base, "unique": "cards", "order": "edhrec", "page": page,
            }, not_found_ok=True)
            for raw in data.get("data", []):
                card = Card.from_api(raw)
                if card.eligible:
                    seen.setdefault(card.oracle_id, card)
                if len(seen) >= limit:
                    break
            if not data.get("has_more"):
                break
            page += 1
        return list(seen.values())
