#!/usr/bin/env bash
# Runs each client's contract check against a REAL RoadLink Core backed by a REAL PostgreSQL/PostGIS.
#
# The checks create incidents and take ambulances, so they cannot share a database: every check
# gets a freshly created and seeded one, and its own server process.
#
# Needs: node, psql, curl, and a PostgreSQL server (with PostGIS) reachable as the admin URL below.
# Locally:  ./scripts/ci-contract.sh        (CI sets the same variables from its service container)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${ADMIN_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB_NAME="roadlink_contract"
PORT="${PORT:-3000}"

export DATABASE_URL="${ADMIN_URL%/*}/${DB_NAME}"
export JWT_SECRET="${JWT_SECRET:-contract-check-secret}"
export SEED_PASSWORD="${SEED_PASSWORD:-ChangeMe123!}"
export NODE_ENV=development
export PORT
export CONTRACT_API_URL="http://localhost:${PORT}"

server_pid=""
stop_server() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; server_pid=""; fi
}
trap stop_server EXIT

run_check() { # $1 = label, $2 = project directory
  echo "::group::contract check: $1"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${DB_NAME}" -c "CREATE DATABASE ${DB_NAME}"
  (cd "$ROOT/roadlink-core" && npm run --silent db:seed)
  (cd "$ROOT/roadlink-core" && exec node src/server.js > "$ROOT/core-$1.log" 2>&1) &
  server_pid=$!
  for _ in $(seq 1 60); do curl -fs "${CONTRACT_API_URL}/health" > /dev/null && break; sleep 0.5; done
  if ! curl -fs "${CONTRACT_API_URL}/health" > /dev/null; then
    echo "RoadLink Core did not start. Its log:"; cat "$ROOT/core-$1.log"; exit 1
  fi
  (cd "$2" && npm run --silent contract)
  stop_server
  echo "::endgroup::"
}

run_check hospital "$ROOT/roadlink-hospital"
run_check dispatch "$ROOT/roadlink-dispatch"
run_check field    "$ROOT/roadlink_field_apps/tools"
echo "All contract checks passed."
