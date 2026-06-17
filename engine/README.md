# World Cup 2026 Simulation Engine

Simulation engine, SQLite persistence, and HTTP API for the FIFA World Cup 2026 group stage and knockout bracket.

The browser UI lives in [`../web/`](../web/) (port 2026).

## Setup

```bash
cd wc-simulation/engine
npm install
npm run seed          # load teams + fixtures into SQLite
```

## HTTP API

Start the REST server (shares the same SQLite database as the web app):

```bash
npm run api                    # http://localhost:3000
npm run api -- --port 8080
npm run api -- --db /path/to/simulations.db
npm run api -- --seed          # force re-seed teams + fixtures
```

Base path: `/api/v1`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/simulations` | List simulations |
| `POST` | `/api/v1/simulations` | Create simulation (`{ "name": "..." }`) |
| `PATCH` | `/api/v1/simulations/:id` | Rename simulation (`{ "name": "..." }`) |
| `DELETE` | `/api/v1/simulations/:id` | Delete simulation |
| `POST` | `/api/v1/simulations/:id/activate` | Mark simulation as last-edited |
| `GET` | `/api/v1/simulations/:id` | Simulation metadata |
| `GET` | `/api/v1/simulations/:id/matches` | All match rows |
| `GET` | `/api/v1/simulations/:id/matches/:matchNumber` | One match |
| `PUT` | `/api/v1/simulations/:id/matches/:matchNumber` | Set score |
| `DELETE` | `/api/v1/simulations/:id/matches/:matchNumber` | Clear score |
| `GET` | `/api/v1/simulations/:id/state` | Full bracket state (resolved teams, standings) |
| `POST` | `/api/v1/simulate/group` | Auto-select empty simulation and simulate group stage |
| `POST` | `/api/v1/simulations/:id/simulate/group` | Poisson-simulate remaining group fixtures |
| `POST` | `/api/v1/simulations/:id/simulate/knockouts` | Poisson-simulate all knockout rounds |
| `GET` | `/api/v1/teams` | List teams with ratings |
| `PATCH` | `/api/v1/teams/:id` | Update team ratings (`{ "offensiveRating", "defensiveRating" }`) |

Set a group-stage score:

```bash
curl -X PUT http://localhost:3000/api/v1/simulations/1/matches/1 \
  -H 'Content-Type: application/json' \
  -d '{"goalsHome":2,"goalsAway":1}'
```

Knockout draws require `winnerTeamId` (home or away team id from `GET .../state`). If upstream matches are not played, `PUT` returns `409` (`match_not_ready`).

Auto-simulate remaining group fixtures (Poisson model from team ratings):

```bash
curl -X POST http://localhost:3000/api/v1/simulations/1/simulate/group
curl -X POST http://localhost:3000/api/v1/simulations/1/simulate/knockouts
```

Locked actual results are never re-simulated.

Master (consensus) view mode is set per prediction in the Predictions view (Floor / Outcome / Scoreline). New predictions default from `CONSENSUS_MODE` when set, otherwise `floor`.

## Stack

- TypeScript simulation engine (`src/engine/`, `src/simulation/`)
- Poisson match model (`src/engine/matchSimulator.ts`)
- Hono HTTP API (`src/api/`)
- SQLite (`better-sqlite3` + Drizzle)
- Fixed reference tables: `teams`, `fixtures`, `group_memberships`
- Per-simulation: `simulations`, `simulation_matches`

Data sources: [`../data/teams.csv`](../data/teams.csv), [`../data/worldcup_2026_fixtures.csv`](../data/worldcup_2026_fixtures.csv), Annex C bracket lookup ([`../data/annex-c.json`](../data/annex-c.json)).

SQLite database: [`../data/simulations.db`](../data/simulations.db) (shared with the web app).

## Tests

```bash
npm test
npm run generate:annex-c   # regenerate Annex C from Wikipedia source
```

## CLI utilities

```bash
npm run sync:simulation -- <simulationId>              # resolve bracket participants
npm run simulate:group -- [--simulation-id N] [--db path]
npm run simulate:knockouts -- [--simulation-id N] [--db path]
```
