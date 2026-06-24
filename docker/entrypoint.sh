#!/bin/sh
set -e

DB_PATH="/app/data/simulations.db"
PORT="${PORT:-2026}"
SEED_FLAG=""

if [ ! -f "$DB_PATH" ]; then
  echo "No database at $DB_PATH — seeding teams and fixtures."
  SEED_FLAG="--seed"
fi

cd /app/web
exec ./node_modules/.bin/tsx server.ts --port "$PORT" --db "$DB_PATH" $SEED_FLAG
