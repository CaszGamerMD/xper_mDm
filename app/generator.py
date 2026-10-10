"""Conservative, explainable singleton Commander deck construction.

This is a heuristic builder, not a gameplay simulator. Legality is a hard gate;
quality is a separately reported estimate based on synergy and deck structure.
"""
from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable

from .scryfall import COLORS, Card, CardDataError, Scryfall, identity
from .seeds import BASICS, ROLE_QUERIES, ROLE_SEEDS, THEMES

PROFILES = [
    ("Theme First", "Maximizes tribal and mechanical synergy.",
     {"ramp": 9, "draw": 9, "removal": 8, "protection": 3, "wipe": 3, "synergy": 27, "finisher": 3}),
    ("Balanced", "A balanced mix of threats, mana, cards and answers.",
     {"ramp": 10, "draw": 10, "removal": 9, "protection": 4, "wipe": 3, "synergy": 22, "finisher": 4}),
    ("Resilient", "Adds answers and protection for longer games.",
     {"ramp": 10, "draw": 11, "removal": 11, "protection": 5, "wipe": 4, "synergy": 18, "finisher": 3}),
    ("Fast Engine", "Leans into early mana and payoff density.",
     {"ramp": 12, "draw": 9, "removal": 7, "protection": 3, "wipe": 2, "synergy": 25, "finisher": 4}),
]
ROLE_ORDER = ["ramp", "draw", "removal", "protection", "wipe", "finisher", "synergy"]
ROLE_LABELS = {
    "ramp": "Ramp", "draw": "Card advantage", "removal": "Interaction",
    "protection": "Protection", "wipe": "Board wipes", "finisher": "Finishers",
    "synergy": "Theme & creatures", "land": "Lands",
}


class InputError(Exception):
    pass


@dataclass
class Request:
    colors: list[str] = field(default_factory=list)
    creature_types: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    commander: str = ""
    favorites: list[str] = field(default_factory=list)
    options: int = 4


@dataclass
class Built:
    commander: Card
    main: list[tuple[Card, str]]
    basics: list[tuple[Card, int]]
    profile_name: str
    profile_description: str
    warnings: list[str]
    confidence: str
    score: int
    theme_hits: int
    role_counts: dict[str, int]


def clean_term(term: str) -> str:
    """Keep user terms out of Scryfall's query grammar."""
    return re.sub(r"[^\w\s+/-]", "", term, flags=re.UNICODE).strip()[:48]


def in_identity(card: Card, commander: Card) -> bool:
    return set(card.color_identity).issubset(commander.color_identity)


def validate_deck(deck: Built) -> None:
    """Final *hard* validation; never return incomplete or unlawful lists."""
    if not deck.commander.eligible or not deck.commander.commander:
        raise InputError("Selected commander is not a legal single-card Commander commander.")
    if len(deck.main) + sum(n for _, n in deck.basics) != 99:
        raise InputError("Could not produce a complete 99-card main deck.")
    names = {deck.commander.name.casefold()}
    for card, _ in deck.main:
        if not card.eligible or not in_identity(card, deck.commander):
            raise InputError(f"Illegal card for this commander: {card.name}.")
        if card.name.casefold() in names:
            raise InputError(f"Duplicate nonbasic card: {card.name}.")
        names.add(card.name.casefold())
    for basic, n in deck.basics:
        if not basic.basic or not basic.eligible or not in_identity(basic, deck.commander) or n < 1:
            raise InputError(f"Invalid basic land: {basic.name}.")


def score_noise(card: Card, variant: int) -> float:
    digest = hashlib.sha256((card.oracle_id + ":" + str(variant)).encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32


def expanded_terms(keywords: list[str]) -> list[str]:
    terms = []
    for raw in keywords:
        key = raw.casefold().strip()
        terms.extend(THEMES.get(key, [key]))
    return list(dict.fromkeys(t for t in terms if t))[:9]


def theme_score(card: Card, creature_types: list[str], terms: list[str]) -> float:
    oracle = card.oracle_text.casefold()
    typeline = card.type_line.casefold()
    keywords = [k.casefold() for k in card.keywords]
    total = 0.0
    for kind in creature_types:
        kind = kind.casefold()
        if card.creature and re.search(r"\b" + re.escape(kind) + r"\b", typeline):
            total += 6.0
        if re.search(r"\b" + re.escape(kind) + r"s?\b", oracle):
            total += 3.2
    for term in terms:
        if term in oracle:
            total += 2.0
        if term in keywords:
            total += 2.8
    return min(total, 18.0)


def role_match(card: Card, role: str, named_seeds: dict[str, set[str]]) -> bool:
    if card.name.casefold() in named_seeds.get(role, set()):
        return True
    text = card.oracle_text.casefold()
    if role == "ramp":
        return any(t in text for t in ("add {", "add one mana", "search your library for a basic land", "treasure token"))
    if role == "draw":
        return any(t in text for t in ("draw a card", "draw two cards", "draw three cards", "draw x cards", "draw cards"))
    if role == "removal":
        return any(t in text for t in ("destroy target", "exile target", "counter target spell", "return target nonland"))
    if role == "protection":
        return any(t in text for t in ("hexproof", "indestructible", "phase out", "protection from"))
    if role == "wipe":
        return any(t in text for t in ("destroy all creatures", "exile all creatures", "each creature gets -", "13 damage to each creature"))
    if role == "finisher":
        return any(t in text for t in ("each opponent loses", "win the game", "creatures you control get +", "deals damage to each opponent"))
    return True


def card_score(card: Card, role: str, theme: float, variant: int) -> float:
    popularity = max(0, 5.6 - math.log10(max(card.edhrec_rank, 1)) * 0.92)
    mana_curve = 1.1 if 1 <= card.cmc <= 4 else (-1.0 if card.cmc >= 8 else 0)
    role_theme = 1.2 if role == "synergy" else 0.4
    bias = [0.35, 0.65, 0.45, 1.35][variant] * score_noise(card, variant) * 2
    if role == "finisher":
        mana_curve = 1.2 if 4 <= card.cmc <= 8 else 0
    if role == "ramp" and card.cmc > 3:
        mana_curve -= (card.cmc - 3) * 0.55
    return popularity + theme * role_theme + mana_curve + bias


class Generator:
    def __init__(self, source: Scryfall):
        self.source = source
        self.seed_cards: list[Card] | None = None
        self.basics: dict[str, Card] | None = None

    def _get_seed_cards(self) -> list[Card]:
        if self.seed_cards is None:
            names = list(dict.fromkeys(name for group in ROLE_SEEDS.values() for name in group))
            self.seed_cards = self.source.collection(names)
        return self.seed_cards

    def _get_basics(self) -> dict[str, Card]:
        if self.basics is None:
            found = {c.name: c for c in self.source.collection(list(BASICS.values()))}
            missing = [name for name in BASICS.values() if name not in found]
            if missing:
                raise CardDataError("Could not load basic lands: " + ", ".join(missing))
            self.basics = {color: found[name] for color, name in BASICS.items()}
        return self.basics

    def _get_favorites(self, req: Request) -> list[Card]:
        cards = []
        for name in req.favorites:
            card = self.source.named(name)
            if not card:
                raise InputError(f"Could not find favorite card: {name}.")
            if not card.eligible:
                raise InputError(f"{card.name} is not legal in paper Commander.")
            if card.name.casefold() not in {c.name.casefold() for c in cards}:
                cards.append(card)
        return cards

    def _commander_options(self, req: Request, favorites: list[Card]) -> list[Card]:
        needed = set().union(*(set(c.color_identity) for c in favorites)) if favorites else set()
        if req.commander:
            card = self.source.named(req.commander)
            if not card:
                raise InputError(f"Could not find commander: {req.commander}.")
            if not card.eligible or not card.commander:
                raise InputError(f"{card.name} is not a legal single-card Commander commander.")
            if req.colors and set(card.color_identity) != set(req.colors):
                raise InputError(f"{card.name}'s color identity is {identity(card.color_identity)}, not {identity(req.colors)}.")
            if not needed.issubset(card.color_identity):
                raise InputError("One or more favorites have colors outside your commander's color identity.")
            return [card]

        exact = f"id={identity(req.colors)}" if req.colors else ""
        pool: dict[str, Card] = {}
        for kind in req.creature_types[:3]:
            q = f'is:commander {exact} o:"{clean_term(kind)}"'
            for c in self.source.search(q, limit=70):
                pool[c.oracle_id] = c
        for term in expanded_terms(req.keywords)[:3]:
            for c in self.source.search(f'is:commander {exact} o:"{clean_term(term)}"', limit=70):
                pool[c.oracle_id] = c
        for c in self.source.search(f"is:commander {exact}", limit=175):
            pool.setdefault(c.oracle_id, c)
        candidates = [c for c in pool.values() if c.commander and c.eligible
                      and needed.issubset(c.color_identity)
                      and (not req.colors or set(req.colors) == set(c.color_identity))]
        if not candidates:
            raise InputError("No legal commander matches those color and favorite-card requirements.")
        terms = expanded_terms(req.keywords)
        ranked = sorted(candidates, key=lambda c: (
            theme_score(c, req.creature_types, terms) * 2.2 +
            max(0, 7 - math.log10(max(1, c.edhrec_rank))) +
            (1.4 if c.creature else 0)), reverse=True)
        return ranked[:req.options]

    def _themes(self, req: Request, commander: Card) -> list[str]:
        terms = expanded_terms(req.keywords)
        if not terms:
            oracle = commander.oracle_text.casefold()
            for key, expansions in THEMES.items():
                if key in oracle:
                    terms.extend(expansions[:2])
            if not terms:
                for key in ("token", "graveyard", "instant", "sorcery", "artifact", "counter", "land", "draw"):
                    if key in oracle:
                        terms.append(key)
        return list(dict.fromkeys(terms))[:9]

    def _pool(self, req: Request, commander: Card) -> tuple[list[Card], list[Card], list[str]]:
        cid = identity(commander.color_identity)
        filter_id = f"id<={cid}"
        terms = self._themes(req, commander)
        spells: dict[str, Card] = {}
        for card in self._get_seed_cards():
            if card.eligible and in_identity(card, commander) and not card.land:
                spells[card.oracle_id] = card
        for kind in req.creature_types[:3]:
            for query in (f't:"{clean_term(kind)}"', f'o:"{clean_term(kind)}"'):
                for card in self.source.search(f"{filter_id} {query} -t:land", limit=160):
                    spells[card.oracle_id] = card
        for term in terms[:5]:
            for card in self.source.search(f'{filter_id} o:"{clean_term(term)}" -t:land', limit=160):
                spells[card.oracle_id] = card
        # A few broad candidate pages prevent under-filled / entirely narrow decks.
        for role in ("ramp", "draw", "removal"):
            for query in ROLE_QUERIES[role]:
                for card in self.source.search(f"{filter_id} {query}", limit=100):
                    spells[card.oracle_id] = card
        for card in self.source.search(f"{filter_id} -t:land", limit=175):
            spells[card.oracle_id] = card
        lands = [c for c in self.source.search(f"{filter_id} t:land -t:basic", limit=160) if c.land]
        return [c for c in spells.values() if not c.land and c.name != commander.name], lands, terms

    def _pick_nonbasics(self, lands: list[Card], commander: Card, variant: int, required: int, excluded: set[str]) -> list[Card]:
        colors = set(commander.color_identity)
        use_counts: Counter[str] = Counter()
        chosen: list[Card] = []
        pool = [land for land in lands if land.eligible and in_identity(land, commander) and
                land.name.casefold() not in excluded and not land.basic]
        utility = 0
        while len(chosen) < required:
            options: list[tuple[float, Card, set[str]]] = []
            for card in pool:
                if card.name.casefold() in excluded:
                    continue
                produced = set(card.produced_mana) & colors
                if not produced and "search your library for a basic land" in card.oracle_text.casefold():
                    produced = colors
                if colors and not produced and utility >= 5:
                    continue
                prefer = (sum(2.8 / (1 + use_counts[c]) for c in produced)
                          + len(produced) * 1.1)
                popular = max(0, 6 - math.log10(max(card.edhrec_rank, 1)))
                randomize = score_noise(card, variant) * 1.2
                options.append((prefer + popular + randomize - (2 if not produced and colors else 0), card, produced))
            if not options:
                break
            _, land, produced = max(options, key=lambda x: x[0])
            chosen.append(land)
            excluded.add(land.name.casefold())
            if not produced:
                utility += 1
            for c in produced:
                use_counts[c] += 1
        return chosen

    def _classify(self, card: Card, seed_set: dict[str, set[str]]) -> str:
        for role in ("ramp", "draw", "removal", "wipe", "protection", "finisher"):
            if card.name.casefold() in seed_set.get(role, set()):
                return role
        for role in ("ramp", "draw", "removal", "wipe", "protection", "finisher"):
            if role_match(card, role, seed_set):
                return role
        return "synergy"

    def _build(self, req: Request, commander: Card, favorites: list[Card],
               profile: tuple, variant: int, pool: tuple[list[Card], list[Card], list[str]]) -> Built:
        title, description, targets = profile
        spell_pool, land_pool, terms = pool
        seed_set = {role: {name.casefold() for name in names} for role, names in ROLE_SEEDS.items()}
        selected: list[tuple[Card, str]] = []
        taken = {commander.name.casefold()}
        warnings = []
        favored = []
        for card in favorites:
            if card.name.casefold() == commander.name.casefold():
                continue  # user has already got the card in the command zone
            if not in_identity(card, commander):
                raise InputError(f"{card.name} is outside {commander.name}'s color identity.")
            favored.append(card)
            if card.name.casefold() in taken:
                continue
            selected.append((card, "land" if card.land else self._classify(card, seed_set)))
            taken.add(card.name.casefold())

        pinned_lands = [c for c, r in selected if r == "land"]
        spells = [(c, r) for c, r in selected if r != "land"]
        if len(pinned_lands) > 37 or len(spells) > 62:
            raise InputError("Too many favorites for the requested deck structure.")
        counted = Counter(role for _, role in spells)
        available = [c for c in spell_pool if c.name.casefold() not in taken and in_identity(c, commander)]
        unfilled = []
        for role in ROLE_ORDER:
            target = targets[role]
            need = max(0, target - counted[role])
            matching = [c for c in available if role_match(c, role, seed_set)]
            ranked = sorted(matching, key=lambda c: card_score(c, role, theme_score(c, req.creature_types, terms), variant), reverse=True)
            additions = ranked[:need]
            if len(additions) < need:
                unfilled.append(role)
            for card in additions:
                spells.append((card, role))
                taken.add(card.name.casefold())
                counted[role] += 1
            available = [c for c in available if c.name.casefold() not in taken]
        # Fill shortfalls, but expose missing role coverage as a quality warning.
        if len(spells) < 62:
            remaining = sorted(available, key=lambda c: card_score(c, "synergy", theme_score(c, req.creature_types, terms), variant), reverse=True)
            for card in remaining[:62 - len(spells)]:
                spells.append((card, "synergy"))
                taken.add(card.name.casefold())
                counted["synergy"] += 1
        if len(spells) < 62:
            raise InputError("Not enough legal, distinct spells to build a complete deck.")
        if len(spells) > 62:
            # Favorites in an already-full category are mandatory, not dropped.
            nonpinned = {c.name.casefold() for c in favored}
            kept = [(c, r) for c, r in spells if c.name.casefold() in nonpinned]
            extras = [(c, r) for c, r in spells if c.name.casefold() not in nonpinned]
            spells = kept + extras[:62 - len(kept)]

        need_nonbasic = max(0, ({0: 17, 1: 11, 2: 19, 3: 24, 4: 26, 5: 28}[len(commander.color_identity)] + (1 if variant == 3 else 0)) - len(pinned_lands))
        nonbasics = self._pick_nonbasics(land_pool, commander, variant, need_nonbasic, taken)
        land_count = len(pinned_lands) + len(nonbasics)
        if land_count > 37:
            raise InputError("Too many nonbasic lands selected.")
        spells.extend((c, "land") for c in pinned_lands + nonbasics)
        colors = list(commander.color_identity) or ["C"]
        basics_needed = 37 - land_count
        # Give more basics to colors underrepresented in nonbasic sources.
        source_counts = Counter()
        for card in pinned_lands + nonbasics:
            for symbol in set(card.produced_mana) & set(colors):
                source_counts[symbol] += 1
        weights = {c: max(1, 9 - source_counts[c]) for c in colors}
        # Multicolor decks must have at least one basic per color when possible.
        counts = Counter({c: 1 for c in colors}) if basics_needed >= len(colors) else Counter()
        for _ in range(basics_needed - sum(counts.values())):
            choice = max(colors, key=lambda c: (weights[c] / (1 + counts[c]), -colors.index(c)))
            counts[choice] += 1
        basics = [(self._get_basics()[c], qty) for c, qty in counts.items() if qty]

        theme_hits = sum(1 for c, role in spells if role != "land" and theme_score(c, req.creature_types, terms) >= 2)
        intent = bool(req.creature_types or req.keywords or terms)
        theme_fraction = theme_hits / max(1, 62)
        if intent and theme_fraction < 0.33:
            warnings.append("Theme support is thin: relatively few cards directly match the requested mechanics or creature types.")
        if unfilled:
            warnings.append("Some ideal role slots lacked clear matches: " + ", ".join(ROLE_LABELS[r] for r in unfilled) + ".")
        if len(nonbasics) < need_nonbasic:
            warnings.append("Limited nonbasic land choices; the mana base relies more heavily on basics.")
        if not req.creature_types and not req.keywords and not terms:
            warnings.append("No clear theme was given or inferred; this is a broadly playable shell, not a tuned strategy.")
        avg_cmc = sum(c.cmc for c, r in spells if r != "land") / 62
        if avg_cmc > 4.2:
            warnings.append("High mana curve may make early turns inconsistent.")
        # Not a predicted win rate; a transparent structural confidence estimate.
        score = 88
        if intent:
            score -= round(max(0, 0.45 - theme_fraction) * 60)
        else:
            score -= 18
        score -= min(25, len(unfilled) * 7)
        score -= max(0, need_nonbasic - len(nonbasics)) * 2
        score -= max(0, avg_cmc - 3.5) * 7
        score = max(0, min(95, round(score)))
        confidence = "High" if score >= 78 else "Medium" if score >= 61 else "Low"
        if confidence == "Low":
            warnings.insert(0, "Low-confidence build: card availability or theme fit may make this deck underperform.")
        deck = Built(commander, spells, basics, title, description, warnings,
                     confidence, score, theme_hits, dict(Counter(role for _, role in spells)))
        validate_deck(deck)
        return deck

    def generate(self, req: Request) -> list[Built]:
        req.colors = [c.upper().strip() for c in req.colors]
        if len(set(req.colors)) != len(req.colors) or any(c not in COLORS for c in req.colors):
            raise InputError("Colors must be unique selections from W, U, B, R, G.")
        req.creature_types = [clean_term(t) for t in req.creature_types if clean_term(t)][:3]
        req.keywords = [clean_term(t) for t in req.keywords if clean_term(t)][:5]
        if len(req.favorites) > 5 or req.options < 1 or req.options > 4:
            raise InputError("Choose up to five favorite cards and up to four decks.")
        favorites = self._get_favorites(req)
        commanders = self._commander_options(req, favorites)
        if not commanders:
            raise InputError("No legal commander could be found.")
        decks = []
        # User-selected commander means four different plans for that commander.
        chosen = [commanders[0]] * req.options if req.commander else commanders[:req.options]
        pool_cache = {}
        for idx, commander in enumerate(chosen):
            key = (tuple(commander.color_identity), tuple(req.creature_types),
                   tuple(req.keywords), commander.oracle_text if not req.keywords else "")
            if key not in pool_cache:
                pool_cache[key] = self._pool(req, commander)
            decks.append(self._build(req, commander, favorites, PROFILES[idx], idx, pool_cache[key]))
        return decks


def card_view(card: Card, quantity: int = 1) -> dict:
    return {"name": card.name, "quantity": quantity, "mana_cost": card.mana_cost,
            "cmc": card.cmc, "type": card.type_line, "image": card.image,
            "url": card.url, "color_identity": list(card.color_identity)}


def deck_view(deck: Built) -> dict:
    grouped: dict[str, list[dict]] = {role: [] for role in ROLE_LABELS}
    for card, role in deck.main:
        grouped[role].append(card_view(card))
    for basic, count in deck.basics:
        grouped["land"].append(card_view(basic, count))
    groups = [{"role": ROLE_LABELS[key], "cards": sorted(grouped[key], key=lambda c: c["name"])}
              for key in ROLE_LABELS if grouped[key]]
    export = "// Commander\n1 " + deck.commander.name + "\n\n// Deck\n"
    export += "\n".join(f"{c['quantity']} {c['name']}" for g in groups for c in g["cards"]) + "\n"
    return {"name": f"{deck.commander.name} — {deck.profile_name}",
            "commander": card_view(deck.commander), "description": deck.profile_description,
            "confidence": deck.confidence, "quality_score": deck.score,
            "warnings": deck.warnings, "theme_cards": deck.theme_hits,
            "counts": {ROLE_LABELS[k]: v for k, v in deck.role_counts.items()},
            "groups": groups, "total_cards": 1 + sum(c["quantity"] for g in groups for c in g["cards"]),
            "export": export}
