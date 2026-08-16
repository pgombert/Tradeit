# Tradeit

A private, single-user research system that gathers financial information from many
independent sources, compresses it into a weekly evidence packet, has Claude form
and then attack an opinion on it, and produces a ranked list of candidate trades
with pre-defined size, stop, and exit date.

**Tradeit does not execute trades.** It produces a brief. Pete reads it, decides,
and places every order himself. Every number traces back to a source row with a
timestamp and a URL.

- Plan: [`docs/PLAN.md`](docs/PLAN.md) — read this first
- Setup and secrets: [`docs/SETUP.md`](docs/SETUP.md)
- Working agreement: [`CLAUDE.md`](CLAUDE.md)
- Deployment: `trade.meadowlark.*`, GCP project `meadowlark-492419`

**Credentials never go in chat, a commit, or any file but `.env`.** Production
secrets live in Google Secret Manager — see [`docs/SETUP.md`](docs/SETUP.md).
Schwab credentials in particular go there and nowhere else.

| | |
|---|---|
| Instruments | Stocks and ETFs only |
| Account | Schwab retirement account |
| Capital | $100,000 |
| Target | $200,000 in a year — +1.34% per week |
| Max drawdown | $30,000 — hard floor at $70,000 |

## Getting started

```bash
docker compose up -d      # Postgres on 5434, Redis on 6381
npm install
cp .env.example backend/.env    # then fill in FRED_API_KEY and the JWT secrets
npm run db:migrate
npm run db:seed           # creates the single account, prints a password once
npm run dev               # backend :4002, frontend :3002
```

Then pull data:

```bash
npm run collect           # every collector
npm run collect -- fred   # just one
```

## Layout

| Workspace | What it holds |
|---|---|
| `packages/shared` | Types, the FRED series list, the risk maths |
| `backend` | API, collectors, and the engine (Express + Prisma + Postgres) |
| `frontend` | Dashboard and the weekly brief (React + Vite) |

## Status

**Phase 0 complete** — monorepo, database, single-user auth, FRED collector, and a
dashboard showing the Treasury curve and collector health. See `docs/PLAN.md` §9
for what was built and what Phase 1 needs first.
