# World Cup 2026 Simulation

Browser app and simulation engine for the FIFA World Cup 2026 group stage and knockout bracket. Run full simulations locally against a shared SQLite database, or publish a static public site that serves pre-exported data and runs personal simulations entirely in the browser.

## Repository layout

| Path | Description |
|------|-------------|
| [`engine/`](engine/) | TypeScript simulation engine, SQLite persistence, REST API, and CLI tools |
| [`web/`](web/) | React + Vite frontend (private dev server or static public build) |
| [`data/`](data/) | SQLite database (`simulations.db`, gitignored), bracket reference data, and seed CSVs |
| [`scripts/`](scripts/) | Optional Python helpers (ratings scraper, iCal export, etc.) |

See [`engine/README.md`](engine/README.md) for the HTTP API and CLI reference, and [`web/README.md`](web/README.md) for frontend-specific notes.

## Quick start (private / local)

The private app runs a local API backed by SQLite and supports creating simulations, editing scores, managing predictions, and Monte Carlo runs.

```bash
# Engine
cd engine
npm install
npm run seed          # load teams + fixtures into data/simulations.db

# Web
cd ../web
npm install
npm run dev           # http://localhost:2026
```

`npm run seed` only needs to run once (or again with `--seed` to force a reload). Both `engine/` and `web/` read from the same database at `data/simulations.db`.

## Public site

The public build is a static site deployed to GitHub Pages. It does not connect to SQLite or the API. Instead it loads JSON snapshots from `web/public/data/` and runs personal simulations in the browser (stored in `localStorage`).

Private and public modes are controlled at build time via `VITE_APP_MODE`:

- **private** (default) — full API, simulation manager, prediction manager, team ratings editor
- **public** — read-only master/actual views from exported JSON; personal simulations run client-side

The live site is built with `npm run build:public` and deployed automatically on push to `main` (see [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)).

## Exporting data for the public version

To update what visitors see on the public site, export a fresh snapshot from your local database, commit the JSON files, and push to `main`.

### Prerequisites

1. A populated `data/simulations.db` with at least one **prediction** configured. The export uses the **active prediction** from Manage Predictions (the most recently opened/updated one; falls back to prediction id `1` if none has been activated). Create and manage predictions in the private app under the Predictions view.
2. Up-to-date simulation aggregates and actual results in the database — whatever you want reflected in the master view and actual-results tab.

### Run the export

From the `engine/` directory:

```bash
cd engine
npm run export:public
```

This writes five JSON files to `web/public/data/`:

| File | Contents |
|------|----------|
| `bootstrap.json` | Teams, fixtures, group memberships, and raw actual results |
| `master-group-state.json` | Consensus master group view (predictions redacted per reveal policy) |
| `master-team-stats.json` | Aggregated team statistics across the prediction pool |
| `actual-results-state.json` | Actual results with standings and resolved matches |
| `meta.json` | Export timestamp, reveal policy, and exported prediction id/name |

Optional flags:

```bash
npm run export:public -- --db /path/to/simulations.db
npm run export:public -- --out ../web/public/data
```

On success the CLI prints a JSON line with `ok`, `outDir`, and `exportedAt`.

### Reveal policy

Exports use a **kickoff** reveal policy: for the master (consensus) view, group-stage and knockout predictions for fixtures whose kickoff has not yet passed at export time are redacted — scores are cleared, outcome distributions zeroed, and (for the group stage) standings are recomputed from revealed matches only. Knockout winner/loser slots that depend on unrevealed matches stay as placeholders (e.g. `W73`) rather than showing predicted teams. Unrevealed knockout actual results are also withheld from the export. Team stats and bootstrap fixture data are always included in full.

Re-export after kickoff to publish newly revealed predictions.

### Publish

1. Review the generated files under `web/public/data/`.
2. Commit them to the repository.
3. Push to `main`. The GitHub Pages workflow runs `npm run build:public` and deploys `web/dist/`.

To verify the public build locally before pushing:

```bash
cd web
npm run build:public
npx vite preview --base /worldcup-simulation/
```

Open the URL printed by `vite preview` (append `/worldcup-simulation/` to match the production base path).

## Tests

```bash
cd engine
npm test
```

Public export behavior (kickoff redaction, standings recomputation) is covered in `engine/tests/publicSnapshot.test.ts`.

## Other utilities

Optional Python scripts in [`scripts/`](scripts/) (`scraper.py`, `export_ical.py`, `recreate_team_ratings.py`) fetch ratings and generate calendar exports. They are not required to run the web app.
