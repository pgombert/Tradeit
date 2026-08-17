# CLAUDE.md

Guidance for Claude Code working in this repository.

## Who you're talking to

Pete is the founder/operator. **He is not a software engineer.** Default every
response to plain English:

- Lead with what he sees and what changes — not file paths, stack traces, or symbols.
- Avoid jargon. If a technical term is unavoidable, define it in the same sentence.
- When proposing a fix, describe the behaviour change, not the architecture.
- Code and SQL belong behind a "want the technical detail?" offer, not in the lead.
- Plain English ≠ vague. Be specific about what's broken and what the fix does.

This applies to chat output. It does not change how you write code or commits.

## What Tradeit is

A private, single-user research system. It gathers financial data from many
independent sources, compresses it into a weekly evidence packet, has Claude form
an opinion and then attack it, and produces a ranked list of candidate trades with
size, stop, and exit date already set.

**Read `docs/PLAN.md` at the start of every session.** It carries the locked
decisions, the arithmetic behind the target, and the phase you're in.

### The hard boundary: Tradeit never trades

The Schwab API can place orders. **We never call those endpoints.** No code in
this repository may POST an order, and no credential stored here may carry write
scope. Tradeit produces a brief; Pete places every order himself. If a task seems
to require automated execution, stop and ask — the answer is no.

## Locked decisions

| | |
|---|---|
| Instruments | Stocks and ETFs only. No options. |
| Account | Schwab retirement account |
| Capital | $100,000 |
| Target | $200,000 in a year — **+1.34% per week** |
| Max drawdown | **$30,000** — hard floor at $70,000 |
| Domain | `trade.meadowlark.*` |

These live in code in `packages/shared/src/types/risk.ts` and in the environment
(`STARTING_CAPITAL`, `MAX_DRAWDOWN`). Change them in one place, never two.

## Foundational rules

### 1. Anything the model produces is validated before it is stored or shown

Any value from Claude — a ticker, a price, a date, a conviction — is checked
against data we already hold before being persisted or displayed. A ticker must
resolve to a `Security` row. A quoted price is replaced with ours. A verdict
citing evidence IDs that don't exist is discarded whole, not partially trusted.

Without this boundary, a hallucination becomes a persisted fact Pete trades on.
This is the most important rule in the repository.

### 2. Money and market values use Decimal, never JavaScript `number`

Prices, yields, spreads, position sizes, P&L — all `Decimal` end to end. Convert
to `number` only for a chart, and only at render time.

- **Pattern:** keep `Decimal` from read to write; use `.add()`, `.sub()`, `.mul()`.
- **Anti-pattern:** `parseFloat(value)`, `Number(value)`, `(a + b).toFixed(2)`.
- **Why:** `0.1 + 0.2 === 0.30000000000000004`. Across a year of trades, pennies
  drift and the attribution numbers stop being trustworthy.

Source values arriving as strings stay strings until Prisma takes them.

### 3. Multi-table writes go through `prisma.$transaction()`

Any operation touching more than one table runs in a transaction with all writes
using `tx`. A crash between two writes leaves partial state, and partial state in
a system that reports performance is silent corruption.

### 4. Collectors are idempotent and keyed on the source's stable ID

Every collector upserts on the external system's own identifier. A crash mid-run
plus a re-run must produce the same end state as a clean run.

- **Pattern:** `upsert({ where: { seriesId_date: {...} } })`, and an `Observation`
  upserted on `(source, sourceRef)`.
- **Anti-pattern:** `create()` in an ingest loop; matching by fuzzy text.

### 5. Never render a number as zero while it is loading

A money or metric value that hasn't arrived renders a skeleton. Treat `null` and
`undefined` as "still loading", never as zero. A flashed `$0` on an equity or P&L
tile is its own kind of bug.

The `<Value>` helper in `frontend/src/pages/Dashboard.tsx` is the pattern.

### 6. User-authored content lives in Postgres

Saved views, notes, annotations, approved trades, anything Pete curates — all
server-side. `localStorage` is for auth tokens and throwaway UI state only.

### 7. Object-level checks even with one user

Every route that reads or mutates a record verifies ownership. One user today
doesn't make an unscoped query correct; it makes it a latent bug.

## Project structure

npm workspaces monorepo:

| Workspace | Stack | Dev port |
|---|---|---|
| `packages/shared` | TypeScript types, constants, risk maths (`@tradeit/shared`) | — |
| `backend` | Express 5 + Prisma + PostgreSQL 16 | 4002 |
| `frontend` | React 19 + Vite 7 | 3002 |

Ports avoid Tally (3000/4000) and Meadowlark (3001/4001). Local Postgres runs on
5434 and Redis on 6381 for the same reason.

Conventions: services in `backend/src/services/`, collectors in
`backend/src/collectors/`, routes in `backend/src/routes/`, validation with Zod,
errors via `AppError` from `middleware/error-handler`. All routes under `/api/`.

**Pure logic goes in its own module.** `fred.parse.ts` holds the collector's pure
helpers precisely so they can be tested without an environment or a database.
Follow that split for new collectors.

## Development

```bash
docker compose up -d          # Postgres 5434, Redis 6381
npm install
npm run db:migrate            # from root
npm run db:seed               # creates the single user, prints a password once
npm run dev                   # backend 4002 + frontend 3002
npm run collect               # run every collector once
npm run collect -- fred       # run one
```

After changing `backend/prisma/schema.prisma`: `cd backend && npx prisma migrate dev`,
then restart the backend. **Never edit a migration that has already been applied** —
create a new one with the incremental change.

`tsx watch` does not reload on `.env` changes. Restart manually.

## Testing

**Run `npm test` after any code change.** Tests must pass before telling Pete
something is done.

- Business logic changes need tests. Bug fixes start with a failing test that
  reproduces the bug.
- Pure functions: import and test directly.
- Services touching Prisma: mock `prisma` with `vi.mock()` — test the logic.
- Anything computing a number Pete acts on gets a test with worked examples.

## Deployment

Google Cloud, project `tradeit-505723`, region `us-central1`. Live at
`https://trade.meadowlark.day` (Firebase Hosting site `tradeit-prod`).

```bash
gcloud builds submit --config=cloudbuild.backend.yaml .   # API + jobs
npm run build -w frontend && firebase deploy --only hosting
```

The build runs migrations through the `tradeit-migrate` Cloud Run Job before the
service rolls out; a failed migration halts the pipeline. Collectors run as the
`tradeit-collect` job on a Cloud Scheduler trigger — deliberately separate from
the API container so a collector crash can't take the app down.

Secrets live in Google Secret Manager, never in the repo.

## Before telling Pete it works

1. `npm test` passes.
2. `npm run lint` passes in every workspace.
3. Backend is actually running: `curl -s localhost:4002/api/health` returns `{"status":"ok"}`.
4. Frontend is actually running on 3002.
5. For any UI change, **look at it** — screenshot the page in light *and* dark
   before saying it's done. Two real bugs in Phase 0 were only visible that way.
