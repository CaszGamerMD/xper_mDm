# xper_mDm · Commander Deck Forge

**Browser-only Commander deck generator. No installation, Python, login, or server needed for visitors.**

The main app lives in [`site/`](site/). It generates up to four 100-card Magic: The Gathering Commander decks, using live card data from [Scryfall](https://scryfall.com/docs/api). Input selected colors, up to three creature types, up to five themes, a locked single commander, and/or five required cards. Add an optional plain-English description and a target average mana value. You can copy lists straight from the webpage without downloading anything.

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
