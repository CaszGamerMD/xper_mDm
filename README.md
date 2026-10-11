# xper_mDm · Commander Deck Forge

**Browser-only Commander deck generator. No installation, Python, login, or server needed for visitors.**

The main app lives in [`site/`](site/). It generates up to four 100-card Magic: The Gathering Commander decks, using live card data from [Scryfall](https://scryfall.com/docs/api). Input selected colors, up to three creature types, up to five themes, a locked single commander, and/or five required cards. Add an optional plain-English description and a target average mana value. You can copy lists straight from the webpage without downloading anything.







## Three pages, mana-base improvements and interactive zone previews (v0.9)

The same browser-only site now has three independent pages accessed by the navigation tabs or URL fragments: **Deck Generator** (#generator), **Deck Doctor** (#doctor), **AI Playtest** (#playtest). Switching pages does not erase the builder, loaded lists or match state. The card-size preference remains available on the generator page and applies throughout the app.

**Mana-aware Deck Doctor:** Ratings now compare colored mana symbols in the deck and commander against available colored mana sources from lands. Land counts are independently evaluated against an approximate 37-land reference. Optimizations may replace spells with lands, surplus lands with spells, or colorless/wrong-color lands with better fixing **when the same estimated construction rating improves**. Suggested one-for-one removals and replacements show card images and links; the report displays an estimated color-source breakdown. This is a heuristic that does not simulate all land search, mana abilities or a deck's actual draw probabilities. Preserve the user-selected cap on changes, commander rules and color legality.

**AI Playtest deck and zone visibility:** Both selected deck previews show their commander and an expandable gallery of the full 99-card list. During a match each player has expandable **Graveyard**, **Exile** and **Command zone** areas; click a card to enlarge its art and Oracle text. Exile/return-to-hand spells in quick-play use corresponding zones rather than being recorded as destruction.

**AI action review:** In quick-play, AI spells likely to change the human's creatures, other permanents or life **pause for explicit acknowledgement** before resolution. In experimental Rules Lab those spells and AI counterspells pause before entering the stack, and the player can respond with supported instants when the spell is placed on the stack. Combat already requires manual block assignment. This is a **confirmation to review an opponent's legal play, not permission to veto it**. It does not add full priority/timing or full Magic rules.

## Deck Doctor: rate and conservatively upgrade uploaded Commander decks (v0.8)

In **Deck Doctor · Rate & improve your deck**, upload a plain-text decklist (TXT, DEK, DEC) or paste an exported list. Enter the commander by name or use a Commander section. The tool verifies the **99-card main deck + 1 single commander** against live Scryfall data, including Commander legality, color identity, land types and singleton requirements. It supports conventional numbered exports (for example, 1 Sol Ring or 1x Sol Ring) and basic land multiples; specialty deck exceptions may require more work.

The report shows transparent **0–100 construction scores** for the original and proposed versions, estimated ramp/draw/removal/protection/wipe/finisher density, inferred tribe and strategy, mana curve, mana-base size, engine cohesion and commander fit. It searches for legal replacements and greedily selects one-for-one changes using the **same scoring criteria** throughout. Choose a maximum of 0, 4, 8 (default), 12 or 20 changes. It leaves cards alone if no replacement provides sufficient estimated improvement. Reports show removed and added names, estimated improvements and the number of original cards retained. You can copy, save or open your tuned deck for AI practice.

**Commander protection:** The submitted commander stays in the main improved list. Optionally, Deck Doctor tests other commanders against the **unchanged original 99 cards**. Only a candidate that keeps all cards and lands legal and improves the construction score by **at least 15 points** is offered. Such commanders appear as optional commander-only alternatives with separate exports. There is never an automatic hidden commander swap.

**Limitations:** These are estimated **deck-construction** and **text-recognizable synergy** scores, not measured win rates or confirmation that combos work. Card-search candidates are a nonexhaustive subset of Scryfall and greedy search is not a globally optimal solver. Scores are comparable *within the same analysis*, not claims of general competitive power. Uploaded decklist text remains in your browser; individual card names are queried against Scryfall directly.

## Builder comfort and opening mulligans (v0.7)

**Start over · clear builder** resets colors, creature types, mechanic choices, the commander, must-have cards, the deck description, target mana value and generated deck results. It does **not** erase the local saved-deck vault or your card display preferences. If a previous generation is still running, its result is ignored so it cannot overwrite the cleared screen.

**Card preview size** slider (90%–180%) scales the deck gallery as well as your hand and battlefield previews in both live modes. The preference is stored in browser localStorage on that device.

**Friendly vs Strict opening mulligans:** Choose the mode above the playtest buttons before starting Live AI or Rules Lab. Both start with a seven-card opening hand.
- **Friendly:** Take as many mulligans as desired; each reshuffles and draws a fresh seven, with no cards to bottom when keeping.
- **Strict:** Take successive seven-card mulligans. If you took **X** strict mulligans, on keeping choose exactly **max(0, X − 1)** cards from that seven to put on the bottom of the library; the game cannot begin until the required selection is submitted. This follows the requested first-free-mulligan variant for 1v1 casual Commander. Since an opening hand has seven cards, Strict mode has a maximum of eight mulligans (a zero-card keep). The AI also evaluates and automatically mulligans its own opening hand (up to three attempts) in the selected mode, then bottoms the required number when Strict.

This is a configurable practice variant, not a claim that it reproduces every official multiplayer/duel Commander mulligan convention. Mulligan mode is saved in browser localStorage for future play sessions.

## Rules Lab milestone (v0.6) — fail-closed gameplay foundations

The new **Rules Lab · strict effects** button starts an independent, experimental implementation alongside the older quick-play simulator. It introduces visible last-in-first-out spell stack resolution, human instant-speed responses, automatic AI counterspell reactions, target checks at casting and resolution, simultaneous creature combat damage, first strike/double strike, lifelink, deathtouch, trample, flying/reach, indestructible, commander tax applied upon casts, and pre/postcombat main-phase windows. It shows supported card percentage **for each deck** and clearly marks unsupported cards instead of pretending their abilities worked.

This is **not yet full Magic**. The only effects recognized by this mode are simple basic mana lands, basic vanilla/evergreen-keyword creatures, and exact supported draw, single-target removal, counterspell, bounce, life gain, and damage spell texts. Many real Commander cards and commanders remain disabled. There is no complete APNAP priority loop, triggers, continuous/replacement effects, activated abilities, casting choices or the full five-phase timing sequence; full multi-blocker assignments are not modeled. Rules Lab coverage is a minimum threshold, **not a guarantee of correct results**.

For meaningful rules acceptance testing, start with two minimal vanilla/evergreen decks or examine the coverage report; don't use this mode for detailed combo claims until the relevant abilities are implemented and tested. The existing **Play live vs AI** option keeps the broader, lower-fidelity practice mode for exploratory games.

Reference for eventual comprehensive behavior: [Magic Comprehensive Rules](https://magic.wizards.com/en/rules), including rules 117 (priority), 405 (stack), 500 (turn structure), 510 (combat damage), and 903 (Commander).

## Interactive AI opponent — live practice (v0.5)

In the saved-deck / playtest area choose a generated or stored player deck, select an imported **saved opponent deck**, and click **Play live vs AI**. The practice table renders opening hands, a free opening mulligan, a visible hand, battlefields, life totals and action log. You decide which land to play, cast spells or your commander, choose attackers, and assign blockers when the bot attacks. The opponent chooses cards to play and makes simple attacking/blocking decisions. Repeat and restart games without downloading anything.

**Not an official or complete MTG rules implementation.** This **rules-lite interactive sandbox** covers one land play per turn, automatic tapping of simplified mana sources, basic mana costs, commander tax, basic creature summoning sickness, straightforward attacks and blocking, 40 life, commander-damage victory, and heuristically interpreted common removal / draw / ramp effects. Many card texts are **not** fully executed; actual stack / priority, most triggers and replacement effects, full combat rules, counters, planeswalker loyalty, additional land drops, face-down cards, modal effects, variable mana, and true multiplayer Commander are not supported. This mode is suitable for hands-on goldfishing and rough pacing observations, **not** determining who would win an actual sanctioned or kitchen-table Commander game. Imported lists are checked for deck construction using Scryfall but not every bespoke deck-building exception is supported.

The older **Run 20 simulated games** button remains available for fast statistical approximations. Neither mode uses a hosted language model or transmits user decks to a central app service; Scryfall requests are used for card verification.

## New: cohesive builds and browser-local 1v1 playtesting

**Deck cohesion (v0.4):** Card selection now identifies a dominant archetype when possible and prioritizes role cards that actually enable or pay off that engine. The generator searches specifically for key enablers and payoffs, favors commander/tribal compatibility, and reports **engine cohesion**, **enabler count**, **payoff count**, and warnings if an engine is too thin. The mana-curve rebalancer avoids trading away major synergy pieces merely to hit the requested average. A high score is **not** a guaranteed strong deck: card interactions and combos are estimated heuristically.

**Local deck vault:** Click **Save to this browser** on a generated deck or paste a 100-card list with a Commander section into the import panel. Imported cards are validated against current Scryfall legality, singleton rules and commander identity. Up to 12 decks are stored in browser **localStorage**, not cookies (cookies are too small), without sending them to an application server. Decks are specific to this device/browser; clearing site data or using a private window erases them. Import supports lines like 1 Sol Ring or 1x Sol Ring and a Commander header; only single-card commanders are supported.

**1v1 strategy simulator:** Select your deck and a saved opponent deck, then run **20 seeded simulated matches** and inspect a sample turn-by-turn log. The AI pilot makes heuristic casting, resource, removal, and attack decisions from card data. **This is not a rules engine and does not accurately execute Magic: The Gathering.** It approximates many aspects (colored mana, stack, timing, damage prevention, triggers, board wipes and blocking). Outcomes labelled **projected** are comparative board-state estimates. Simulated results are useful for rough mana curve / pressure exploration **only**, not win-rate predictions, balance verification, or proof that a combo works. The implementation runs in JavaScript in the visitor's browser and uses no paid AI API or uploaded decklist history.

## Open in your browser

Once GitHub Pages is enabled, the site is published at:

**https://caszgamermd.github.io/xper_mDm/**

If this link is not live yet, the repository owner needs to do the one-time setting:

1. Open [Repository Settings → Pages](https://github.com/CaszGamerMD/xper_mDm/settings/pages).
2. Under **Build and deployment**, choose **GitHub Actions** as the **Source**.
3. Open the [Publish Browser Commander Deck Forge workflow](https://github.com/CaszGamerMD/xper_mDm/actions/workflows/pages.yml) and run it with **Run workflow** (or push another commit to `main`).
4. When the workflow reports a successful deployment, open the site link above. Future changes to `site/` on `main` deploy automatically.

This does **not** require the player to download any files, run local software, or install dependencies. GitHub Pages serves plain HTML, CSS, and JavaScript. The browser talks directly to Scryfall over HTTPS. Live card search does require an internet connection. The app is not available offline.

## Features

- Exact selected color identity or automatic commander search; when a commander is named it is used for all deck options.
- User themes and creature types influence candidate searches and deck composition. Five required cards are guaranteed unless forbidden by Commander legality.
- Four deck plans: **Theme First**, **Balanced**, **Resilient**, and **Fast Engine**.
- Validates **100 cards total**, singleton nonbasic cards, paper Commander legality / bans, commander eligibility, and card color identity. Also checks **basic land subtype restrictions** required by Commander rule 903.5d.
- A 37-land mana base and explicit allocation to ramp, card advantage, interaction, protection, sweepers, finishers, and synergy.
- Confidence score and warnings are **heuristics, not playtested win-rate estimates**.
- Browse deck cards as a **visual Scryfall card gallery** or as a compact list, with type-first / mana-value-first sorting. Artifact creatures appear with creatures and artifact lands with lands.
- Optional **target average mana value** slider (1.5–5.5) rebalances the nonland 99 toward the chosen average, preserves required cards and role allocation, reports the actual result, and warns when the target cannot be closely reached. The commander and all lands are excluded from the calculation.
- **Plain-English deck prompt** interprets supported creature types and themes locally with explicit keyword matching. It does not silently send text to a paid AI service or understand every possible request; recognized themes are shown as you type. Explicit filters take priority.
- Copy a decklist right from the browser; optional `.txt` export for deck sites that accept text imports.
- No advertising, accounts, trackers, API keys, or user data uploads to this project. Card lookup queries go directly to Scryfall.

## Rules and limits

This first release builds **one-commander** lists only; it does not construct partner/Background/Doctor's companion pairs, sideboard companions, or specialty deckbuilding exceptions. It aims for conservative legality, and never intentionally returns an incomplete list. It cannot prove card interactions actually work, nor predict power or competitive performance. Verify lists for special tournament requirements and check the current official Commander ban list when necessary.

Data comes from live Scryfall searches (`legalities.commander` and paper-game status) and reflects its accuracy at generation time. Browser requests are rate spaced and cached in memory to respect [Scryfall's API usage limits](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17). If Scryfall or browser cross-origin access is unavailable, the app shows an error rather than constructing an unverified deck.

## Developing and testing

The new browser app requires **no build tooling** and lives in:

```text
site/index.html          Browser UI
site/app.js              Form, results, copy/export UI
site/style.css           Responsive layout
site/generator.mjs       Generator, Scryfall API adapter, rules validation
site/intent.mjs          Local natural-language theme and creature parser
site/presentation.mjs    Card-type, mana-value sorting, average calculation
site/seeds.mjs           Theme aliases and curated role cards
site/tests/              Offline Node.js tests using an injected fake Scryfall catalog
.github/workflows/pages.yml   Automatic GitHub Pages publishing
```

To run optional development tests with Node.js 22 or newer:

```bash
node --test site/tests/*.test.mjs
```

`app/`, `tests/`, and the Python dependencies are retained as the **older optional FastAPI prototype** and its tests. They are **not used or installed** by the browser app or GitHub Pages.

Magic: The Gathering, its trademarks, and card artwork belong to Wizards of the Coast. Card data and images provided by Scryfall. Unofficial fan project.
