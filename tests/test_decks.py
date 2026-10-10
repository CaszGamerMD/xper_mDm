from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.generator import Built, Generator, InputError, Request, card_view, deck_view, validate_deck
from app.scryfall import Card, Scryfall, identity
from app.main import app


def card(name, types="Artifact", color=(), text="", produced=(), rank=1000):
    return Card(name=name, oracle_id=name, type_line=types, oracle_text=text,
                mana_cost="{2}", cmc=2, color_identity=tuple(color),
                legal=True, paper=True, keywords=(), edhrec_rank=rank,
                produced_mana=tuple(produced), image="", url="https://scryfall.com")


class FakeCatalog:
    def __init__(self):
        self.commander = card("Captain of Frogs", "Legendary Creature — Frog Wizard", ("U", "G"), "Frogs you control draw a card")
        self.bad_commander = replace(self.commander, name="Bad Captain", oracle_id="Bad Captain", legal=False)
        self.frog = card("Favorite Frog", "Creature — Frog", ("G",), "Trample")
        self.red = card("Red Goblin", "Creature — Goblin", ("R",))
        self.pinned_land = card("Favorite Coast", "Land", (), "{T}: Add {U}.", ("U",))
        self.spells = []
        roles = [
            ("Ramp", "{T}: Add {G}."),
            ("Draw", "Whenever a Frog attacks, draw a card."),
            ("Removal", "Destroy target creature."),
            ("Protection", "Target Frog gains hexproof."),
            ("Wipe", "Destroy all creatures."),
            ("Finisher", "Each opponent loses 3 life."),
            ("Synergy", "Frogs you control get +1/+1."),
        ]
        for prefix, effect in roles:
            for i in range(40):
                self.spells.append(card(f"{prefix} {i}", "Creature — Frog" if prefix == "Synergy" else "Artifact", (), effect, rank=i + 1))
        self.lands = [card(f"Utility {i}", "Land", (), "{T}: Add {G}.", ("G",), rank=i + 1) for i in range(55)]
        self.basics = [card(name, f"Basic Land — {name}", (key,) if key != "C" else (),
                            produced=(key,)) for key, name in {
                                "W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest", "C": "Wastes",
                            }.items()]

    def named(self, name):
        return {"Captain of Frogs": self.commander, "Bad Captain": self.bad_commander,
                "Favorite Frog": self.frog, "Red Goblin": self.red, "Favorite Coast": self.pinned_land}.get(name)

    def collection(self, names):
        return [c for c in self.basics if c.name in names]

    def search(self, query, limit=150):
        if "is:commander" in query:
            return [self.commander]
        if "-t:land" in query:
            return self.spells[:limit]
        if "t:land" in query:
            return self.lands[:limit]
        return self.spells[:limit]


def test_exactly_100_and_legality_all_four_decks():
    forge = Generator(FakeCatalog())
    decks = forge.generate(Request(colors=["G", "U"], commander="Captain of Frogs",
                                  creature_types=["Frog"], favorites=["Favorite Frog", "Favorite Coast"], options=4))
    assert len(decks) == 4
    for deck in decks:
        validate_deck(deck)
        names = [c.name for c, _ in deck.main]
        assert "Favorite Frog" in names and "Favorite Coast" in names
        assert deck_view(deck)["total_cards"] == 100
        assert deck.commander.name not in names
        assert sum(1 for name in names if name == "Favorite Frog") == 1
        assert "// Commander\n1 Captain of Frogs" in deck_view(deck)["export"]


def test_input_rejects_off_color_must_haves():
    with pytest.raises(InputError, match="outside"):
        Generator(FakeCatalog()).generate(Request(commander="Captain of Frogs", favorites=["Red Goblin"]))


def test_color_identity_conflict():
    with pytest.raises(InputError, match="color identity"):
        Generator(FakeCatalog()).generate(Request(commander="Captain of Frogs", colors=["G"]))


def test_banned_commander_rejected():
    with pytest.raises(InputError, match="not a legal"):
        Generator(FakeCatalog()).generate(Request(commander="Bad Captain"))


def test_duplicate_card_rejected():
    commander = card("Chief", "Legendary Creature — Frog", ("G",))
    duplicates = [(card("Sol Ring"), "ramp"), (card("Sol Ring"), "draw")]
    basics = [(card("Forest", "Basic Land — Forest", ("G",)), 97)]
    deck = Built(commander, duplicates, basics, "", "", [], "Low", 0, 0, {})
    with pytest.raises(InputError, match="Duplicate"):
        validate_deck(deck)


def test_illegal_and_offcolor_main_cards_rejected():
    commander = card("Chief", "Legendary Creature — Frog", ("G",))
    basics = [(card("Forest", "Basic Land — Forest", ("G",)), 98)]
    deck = Built(commander, [(card("Forbidden", color=("B",)), "synergy")], basics, "", "", [], "Low", 0, 0, {})
    with pytest.raises(InputError, match="Illegal"):
        validate_deck(deck)


def test_api_health_and_validation():
    client = TestClient(app)
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.post("/api/generate", json={"options": 5}).status_code == 422
    assert client.get("/").status_code == 200


def test_colorless_identity():
    assert identity([]) == "C"
    assert identity(["G", "U"]) == "UG"
