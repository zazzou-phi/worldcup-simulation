# World Cup 2026 Web App

Browser UI for manually simulating the FIFA World Cup 2026 group stage and knockout bracket.

Shares the same SQLite database as the [simulation engine](../engine/) at [`../data/simulations.db`](../data/simulations.db).

## Setup

```bash
cd wc-simulation/engine
npm install
npm run seed          # load teams + fixtures (once)

cd ../web
npm install
```

## Run

```bash
npm run dev           # http://localhost:2026 (Hono API + Vite HMR)
npm run build         # production frontend → dist/
npm start             # serve built app + API on port 2026
```

## Features

- Group standings (12 groups) with fixture list and inline score entry
- Knockout bracket and list views with tie-breaker winner picker
- Auto-simulate group stage and knockouts (Poisson model from team ratings)
- Simulation manager (create, switch, rename, delete)
- Team ratings editor (offensive / defensive)

## Stack

- React + Vite (frontend)
- Hono + shared backend from [`../engine/src/`](../engine/src/)
- SQLite via `better-sqlite3`
