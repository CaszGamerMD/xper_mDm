# xper_mDm · Commander Deck Forge

A locally runnable web app that generates **up to four 100-card Magic: The Gathering Commander decks** based on a desired color identity, creature types, keywords/themes, a specific commander, and up to **five required cards**.

![Python](https://img.shields.io/badge/Python-3.11+-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-server-009688)

## Features

- **Flexible input:** leave colors blank for discovery, select an *exact* color identity, add up to three creature types and five mechanics, lock to a named legendary creature, and/or provide up to five required card names (one per line).
- **Four deck directions:** Theme First, Balanced, Resilient, and Fast Engine. If a commander is specified, all four use that commander; otherwise, the tool tries to suggest different eligible commanders.
- **Current Commander legality:** every exported deck is validated to have exactly 100 cards (one commander and 99 others), Commander-legal paper cards only, and no off-color cards or duplicate nonbasic names. Legality and card identities come from [Scryfall](https://scryfall.com/docs/api), including current bans.
- **Deck composition:** a 37-land mana base, ramp, card advantage, interaction, protection, sweepers, finishers, and theme pieces. Familiar staples are combined with theme searches and commander-relevant cards. Mandatory cards are never silently excluded (except if one is already the commander).
- **Confidence warnings:** an explicitly *heuristic* score based on role coverage, theme fit, mana curve, and land availability; weak decks receive a warning. This is **not a predicted win rate** or a substitute for playtesting.
- **Export:** copy the decklist or download `.txt` for decklist import. Individual card names link to Scryfall.

## Run it

Requires **Python 3.11+** and internet connectivity to Scryfall for live card data.

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Then visit **http://127.0.0.1:8000**. The local server serves the UI; no paid API key, separate JavaScript build process, or account is required.

To run tests:

```bash
pip install -r requirements-dev.txt
pytest -q
```

## Design and constraints

**Rules checked:** one eligible commander, exactly 100 total cards, singleton rule (basic lands excepted), card color identities contained within the commander's identity, and Scryfall's `legalities.commander == legal` and paper-game flag. The tool deliberately generates **single-commander** decks; it does not yet build Partner/Background/Doctor's companion pairs, external companion cards, or special overrides of singleton rules. A commander with Partner can be used alone.

**Deck quality:** heuristic matching uses Oracle text, known keyword families, subtype matches, card popularity (`edhrec_rank`), approximate curve and a small set of role seed cards. Results are **complete and checked for construction legality, not mathematically optimized or playtested**. Highly unusual interactions and sparse tribes may get low-quality warnings; there is no bracket, budget, matchup, or metagame optimization yet. Nonbasic fixing is chosen using Scryfall-produced mana and supplemented with basics. Data quality depends on Scryfall's up-to-date card records.

**API fairness:** Uses a descriptive `User-Agent`, an `Accept` header, 120 ms spacing between live API requests, a 500 ms delay between card-collection batches, and in-memory 24-hour caching. Searches are bounded to at most two pages; it does **not** crawl the whole card database. Heavy production deployment should switch to Scryfall's bulk-data exports and an indexed local catalog rather than scaling live requests.

**External service:** data from [Scryfall](https://scryfall.com) (unofficial fan project). Magic: The Gathering and all card art are owned by Wizards of the Coast. You should always reconfirm current legality before a sanctioned event or tournament.

## Known limitations

- The current algorithm searches live card text/rankings and can't guarantee a powerful or synergistic deck. Confidence warns when role or theme signals look poor.
- Mana base and curve are heuristic; no simulated opening hands or pip-weighted source calculations.
- Each deck uses one commander (no co-commanders), and specialty deck-building exceptions beyond basic lands aren't actively generated.
- Live Scryfall availability is required on a first run; transient rate-limit / network errors are shown rather than producing guessed or partial lists.

## Project layout

```text
app/main.py          FastAPI routes
app/scryfall.py      Card types, Scryfall access, caching and throttling
app/generator.py     Commander selection, deck construction and validation
app/seeds.py         Theme aliases and role cards
app/static/          Responsive web frontend
 tests/              Offline legality and builder tests
```
