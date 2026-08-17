#!/usr/bin/env bash
#
# Sets Tradeit up on your own machine, start to finish.
#
#   ./infra/bootstrap-local.sh
#
# Safe to re-run. It won't overwrite an existing backend/.env, and the database
# steps are no-ops once they've been applied.

set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
skip() { printf '  \033[90m·\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

# ---------------------------------------------------------------------------
bold "1. Checking what's installed"

missing=0
for cmd in node npm docker openssl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd"
  else
    warn "$cmd is not installed"
    missing=1
  fi
done
[ "$missing" -eq 0 ] || { echo; echo "Install the missing tools above, then run this again."; exit 1; }

node_major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
if [ "$node_major" -lt 20 ]; then
  warn "Node $(node -v) is older than the version this project expects (20+)."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  warn "Docker is installed but not running — start Docker Desktop, then run this again."
  exit 1
fi
ok "Docker is running"

# ---------------------------------------------------------------------------
bold "2. Starting Postgres and Redis"

docker compose up -d >/dev/null
ok "containers up (Postgres on 5434, Redis on 6381)"

printf '  waiting for Postgres'
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U tradeit >/dev/null 2>&1; then
    printf '\n'; ok "Postgres is accepting connections"; break
  fi
  printf '.'; sleep 1
done

# ---------------------------------------------------------------------------
bold "3. Configuration"

if [ -f backend/.env ]; then
  skip "backend/.env already exists — leaving it alone"
else
  # Generated, not invented. These are local-only and should not match production.
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  JWT_REFRESH="$(openssl rand -base64 48 | tr -d '\n')"

  echo
  echo "  Your FRED API key — free, from https://fredaccount.stlouisfed.org/apikeys"
  echo "  Nothing you type is shown. Press enter to skip and add it later."
  read -rsp "  FRED_ID: " FRED_KEY
  echo
  echo "  Your Finnhub API key — free, from https://finnhub.io/register (earnings)"
  read -rsp "  FINHUB_APIKEY: " FINNHUB_KEY
  echo

  sed \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${JWT_REFRESH}|" \
    -e "s|^FRED_ID=.*|FRED_ID=${FRED_KEY}|" \
    -e "s|^FINHUB_APIKEY=.*|FINHUB_APIKEY=${FINNHUB_KEY}|" \
    .env.example > backend/.env

  chmod 600 backend/.env
  unset JWT JWT_REFRESH FRED_KEY FINNHUB_KEY

  ok "wrote backend/.env (gitignored, readable only by you)"
fi

# ---------------------------------------------------------------------------
bold "4. Dependencies"

npm install --silent
ok "installed"

npm run build:shared --silent >/dev/null
ok "built shared types"

# ---------------------------------------------------------------------------
bold "5. Database"

npm run db:migrate --silent >/dev/null 2>&1 || npm run db:migrate
ok "schema applied"

# Prints a generated password exactly once if the account doesn't exist yet.
npm run db:seed

# ---------------------------------------------------------------------------
bold "6. Checks"

npm test --silent >/dev/null 2>&1 && ok "tests pass" || warn "tests failed — run 'npm test' to see why"

if grep -q '^FRED_ID=.\+' backend/.env; then
  bold "Pulling real data"
  npm run collect -- fred
else
  bold "No FRED key yet"
  echo "  Add one to backend/.env, then run:  npm run collect -- fred"
  echo "  Until then the dashboard renders empty rather than fabricating numbers."
fi

# ---------------------------------------------------------------------------
bold "Ready"
echo "  npm run dev        backend on :4002, dashboard on http://localhost:3002"
echo
echo "  Sign in with the email and password printed above. If you've run this"
echo "  before and don't have the password, reset it with:"
echo "      SEED_PASSWORD='your-choice' npm run db:seed -- --force"
