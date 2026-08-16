# Tradeit — Build Plan

**Owner:** Pete Gombert (sole user, sole decision-maker)
**Repo:** `pgombert/Tradeit`
**Deploys to:** a subdomain of Meadowlark (GCP project `meadowlark-492419`)
**Status:** Plan drafted 2026-08-16. Phase 0 ready to start.

---

## 0. What this is, and what it is not

**What it is.** A weekly research pipeline. It pulls from a wide set of independent
financial sources — market data, economic releases, SEC filings, newsletters you
subscribe to, sentiment and positioning gauges — normalizes all of it into one
timestamped store, builds a compact evidence packet for each candidate trade, and
asks Claude to form an opinion on that packet. A second Claude pass then tries to
destroy that opinion. What survives goes into a Sunday-evening brief with a
recommended size, entry zone, stop, and a hard exit date.

**What it is not.** It is not an execution system. It places no orders, holds no
brokerage credentials with trading permission, and has no auto-trade path. Claude
is a research analyst on this project, not an adviser and not a fiduciary. Pete
reads the brief, decides, and enters every order personally. The system's job is to
make sure the decision is made against organized evidence instead of a feed.

**A note on the target, stated once.** Turning $100,000 into $1,000,000 in a year on
weekly holds requires compounding **4.5% net every single week for 52 weeks**
(10^(1/52) − 1 = 4.53%). Long-only stock and ETF positions held for a week don't
move enough to get there — reaching 4.5%/week reliably requires leverage, in
practice defined-risk options, where a good week is +40% and a bad week is −100% of
premium. The return distribution that occasionally produces a 10x also produces a
total loss far more often than it produces the 10x. That is a statement about
arithmetic, not about skill.

So the plan below does two things at once: it builds exactly the system described,
and it instruments the system so the tradeoff is visible in numbers rather than
felt in hindsight. The dashboard's headline metric is **expectancy per unit of risk**,
with the 10x pace shown alongside it as a stretch line. Section 6 proposes splitting
the $100k into a core sleeve and an aggressive sleeve so that a bad month reduces
the position size instead of ending the program. Pete can override any of that — it's
his money and his call — but the plan defaults to keeping the program alive long
enough to learn something.

---

## 1. Architecture

Deliberately the same shape as Tally, Meadowlark, and Nourish, so there's nothing
new to learn and the deploy story is copy-paste.

### Monorepo (npm workspaces)

| Workspace | Stack | Dev port | Purpose |
|---|---|---|---|
| `packages/shared` | TypeScript | — | Shared types (`@tradeit/shared`) |
| `backend` | Express 5 + Prisma + PostgreSQL 16 + Redis | 4002 | API, collectors, engine |
| `frontend` | React 19 + Vite 7 | 3002 | The dashboard and weekly brief |

Ports chosen to avoid colliding with Tally (3000/4000) and Meadowlark (3001/4001)
when several projects run locally at once. Local Postgres on **5434**, Redis on
**6381**, same reasoning.

### Production

- **Backend** → Cloud Run service `tradeit-api`, region `us-central1`
- **Frontend** → static build served behind the same Firebase Hosting pattern
  Meadowlark uses, with `/api/**` rewritten to the Cloud Run service
- **Database** → Cloud SQL Postgres (smallest tier; this is one user and modest data)
- **Secrets** → Google Secret Manager, exactly as Tally does
- **Scheduling** → Cloud Scheduler → Cloud Run **Jobs** (not cron inside the API
  container, so a collector crash can't take down the app)
- **Errors** → Sentry, same setup as Tally

### Auth

Reuse the Meadowlark JWT + Google OAuth code, then hard-allowlist a single email
address in the auth middleware. One user, one account. No signup route, no
password reset, no invites. This is the one place we deliberately build *less* than
the other projects.

### Engineering standards

The Tally `CLAUDE.md` standards apply here verbatim and matter more, not less:

- **Money is `Decimal` end to end.** Never `number`, never `parseFloat`, never
  `.toFixed()` mid-calculation.
- **Multi-table writes go through `prisma.$transaction()`.**
- **AI output is validated against canonical data before it is persisted or shown.**
  If Claude names a ticker, the ticker must resolve to a row we already hold, or
  the recommendation is rejected. If Claude cites a price, we substitute our own.
  This is the single most important rule in this repo.
- **Every importer is idempotent** and keyed on the source's stable ID, so a
  crashed collector re-runs cleanly.
- **Never render `$0` while a value is loading.** In a P&L view a flashed zero is
  worse here than it is in Tally.

A `CLAUDE.md` carrying these forward gets committed in Phase 0.

---

## 2. The data layer

### The core idea: one signal bus

Every collector writes into a single `Observation` table — `source`, `sourceRef`
(the stable external ID), `scope` (ticker, sector, or `MARKET`), `observedAt`,
`ingestedAt`, `kind`, `payload` (JSONB), `url`. Structured domains that need real
querying get their own tables alongside it (`PriceBar`, `EconSeries`, `Filing`,
`NewsletterItem`, `Catalyst`).

The rule this buys us: **Claude never sees raw HTML or a raw feed.** It sees a
curated, deduplicated, timestamped packet assembled from these tables, where every
line has an ID that can be cited and audited afterward. That's what makes
attribution in Section 5 possible, and it's what keeps hallucinated evidence out.

### Sources, in build order

**Tier 1 — free, high signal, build first**

| Source | What we take | Cost |
|---|---|---|
| **FRED** (St. Louis Fed) | Yield curve (`DGS2`, `DGS10`, `T10Y2Y`), real yields, CPI/PCE, weekly jobless claims (`ICSA`), NFCI financial conditions, HY credit spreads (`BAMLH0A0HYM2`), money supply | Free, 1,000 req/day |
| **SEC EDGAR** | Form 4 insider transactions (clusters matter), 8-K, S-1/424B lockup expiries, XBRL company facts, full-text search | Free |
| **Treasury FiscalData / BLS / BEA** | Auction schedule, CPI/employment release detail | Free |
| **Alpaca** | Intraday and daily bars, free IEX feed — enough for research and paper trading | Free |
| **Finnhub** free tier | Earnings calendar, basic news | Free, 60 calls/min |
| **CBOE / public** | VIX level and term structure (VIX vs VIX3M), put/call ratio | Free |
| **AAII / NAAIM** | Weekly retail sentiment, active-manager exposure | Free |
| **FINRA** | Short interest (bi-monthly) | Free |

**Tier 2 — paid, add once Tier 1 is flowing**

| Source | What it adds | Cost |
|---|---|---|
| **Tiingo Power** | Clean EOD history, fundamentals, and news in one tier — the research backbone | ~$50/mo |
| **Polygon.io (Massive) Advanced** | Full SIP tape real-time + **options chains**. Only needed if we trade options — which Section 6 says we probably do | ~$199/mo |

Recommendation: start on Alpaca free + Tiingo. Add Polygon at the point we commit
to options, not before.

**Tier 3 — newsletters**

Set up a dedicated Gmail account, subscribe every newsletter to it, and ingest via
the Gmail API — we already have the Google OAuth plumbing from Meadowlark. Each
email is parsed into a `NewsletterItem`: source, published date, tickers mentioned,
stance (bullish/bearish/neutral), stated conviction, stated horizon, and the raw
text retained for citation.

Two constraints, stated plainly. **Personal use only** — content from paid
newsletters is ingested for Pete's own decision-making and never redistributed, and
each publisher's terms should be checked before adding it. And **newsletters are
the least trustworthy source in the system**: they have incentives, they're often
late, and some are outright promotional. Section 5's attribution engine exists
largely to find out, empirically, which ones actually add anything. Expect to cut
most of them by week 10.

**Tier 4 — derived in-house**

Computed from data we already hold, not bought: relative strength vs SPY, 20/50/200
day moving averages, ATR, RSI, volume surges, gap statistics, sector rotation
(sector ETFs vs SPY), market breadth, realized vs implied volatility, and
correlation of each candidate to the current book.

---

## 3. The weekly engine

Run as a Cloud Run Job chain on Sunday. The design principle throughout: **use AI
for judgment on structured evidence, and deterministic code for anything involving
a number that touches money.**

### Stage 0 — Regime classification (deterministic)

Score the market from hard data only: trend (SPY vs its 50/200 DMA), volatility
(VIX level and whether the term structure is in contango or backwardation), credit
(HY spread direction), rates (2s10s, real yields), and breadth. Output one of four
states — **Risk-On Trend / Chop / Risk-Off / Crisis**.

The regime sets the week's total risk budget before a single candidate is looked
at. This is the most important control in the system: it's what stops the machine
from deploying full size into a falling market because the individual stories
sounded good.

### Stage 1 — Candidate generation (deterministic)

Independent screens, each producing candidates with provenance attached. Roughly
20–40 names per week across:

- Momentum / relative-strength leaders
- Names with a catalyst inside the holding window (earnings, FDA, investor day)
- Insider cluster buying from Form 4
- Newsletter consensus and newsletter divergence
- Unusual options activity (once options data is live)
- Oversold mean-reversion within intact uptrends
- Macro-driven sector and ETF expressions of the regime call

### Stage 2 — Evidence dossier (deterministic)

For each candidate, assemble a compact structured packet: price and volatility
stats, every catalyst inside the window, fundamentals, what each newsletter said
and *when* they said it, insider activity, options positioning, and correlation to
what's already held. Every line carries an observation ID.

### Stage 3 — Analyst pass (Claude)

Claude reads one dossier and returns strict JSON: thesis, direction, conviction
(1–5), entry zone, stop level, target, horizon, the catalyst it's keyed to, **what
would prove the thesis wrong**, and the specific evidence IDs relied on.

Then the validation gate: every ticker must resolve to a security we hold data for,
every cited price is replaced with ours, every cited date is checked against the
calendar table, and any recommendation citing evidence IDs that don't exist is
discarded outright. Nothing from the model reaches the brief unverified.

### Stage 4 — Red team pass (Claude)

A separate call with one job: kill the thesis. What's the bear case? What's already
priced in? Is this a crowded trade? Is the newsletter that surfaced it promotional?
What did the analyst pass ignore? A thesis that survives with conviction intact
moves forward. One that doesn't is logged with its cause of death — that log is
worth as much as the trades.

### Stage 5 — Portfolio construction (deterministic — no AI)

- Sizing on a **fractional Kelly** basis, capped hard (¼ Kelly, and never more than
  a fixed % of capital in one position)
- Correlation and sector caps, so five names aren't secretly one bet
- Total risk deployed for the week is capped by the Stage 0 regime
- **Every position gets a stop and a mandatory exit date at entry.** Positions last
  a week; the exit is scheduled, not decided later under pressure
- Circuit breakers: a −10% week halves next week's size; −20% from peak pauses
  trading for a week and forces a review; −30% is a full stop and a rebuild

### Stage 6 — The Sunday brief

One page in the app: the regime call and why, the week's risk budget, the ranked
trades with size/entry/stop/exit, what changed since last week, **what we got wrong
last week**, and the open-position ledger. Pete approves or rejects each line
individually. Nothing moves without that click, and the click is a record, not a
trigger.

### Stage 7 — Logging and attribution

Fills get entered manually or imported from the broker (the same import pattern
Tally uses). Then the system measures itself: hit rate, average win vs average
loss, expectancy, drawdown — and critically, **alpha per source** and **alpha per
signal type**. Which newsletter actually predicted anything? Do insider clusters
work in this regime? Is the regime classifier itself accurate?

This is the part that makes the system improve rather than merely accumulate. After
about ten weeks there's enough data to start cutting sources that contribute noise.

---

## 4. Build phases

Each phase ends with something running, not a milestone document.

| Phase | Work | Output |
|---|---|---|
| **0** — this week | Monorepo scaffold, Prisma schema, `CLAUDE.md`, Cloud Run + Cloud SQL + subdomain, single-user auth, FRED + Alpaca collectors | Deployed shell showing live yield curve and prices |
| **1** | Gmail newsletter ingestion, SEC EDGAR, catalyst calendar, sentiment collectors, the `Observation` bus with provenance | All sources flowing into one store |
| **2** | Regime engine, screens, dossier builder | First automated Sunday brief — rules only, no AI yet |
| **3** | Claude analyst pass, red team pass, validation gate | First full brief |
| **4** | Risk engine, position ledger, circuit breakers, approval flow | **Paper trading begins** |
| **5–8** | Paper trade live. Attribution dashboard. Backtest what's backtestable. Cut sources that don't earn their place | Four+ weeks of honest track record |
| **9** | Go/no-go review against real numbers | Real capital, if expectancy is positive |

**On the paper-trading gate.** Four to six weeks of paper trading costs about 10% of
the year. Skipping it means funding an untested hypothesis with $100,000 — and,
worse, having no way to tell a bad system from a bad month when the first drawdown
arrives. The gate isn't caution for its own sake; it's the only way the attribution
data in Stage 7 becomes trustworthy. If Pete wants to run a small real-money sleeve
in parallel during this window to keep the psychology honest, that's a reasonable
override.

---

## 5. Running cost

| Item | Monthly |
|---|---|
| GCP (Cloud Run, Cloud SQL small, Scheduler, Secret Manager) | $40–70 |
| Anthropic API (weekly cadence, Opus for analyst + red team) | $20–60 |
| Tier 1 data (FRED, EDGAR, Alpaca, Finnhub, CBOE, FINRA) | $0 |
| Tiingo Power | ~$50 |
| Polygon Advanced — only if trading options | ~$199 |
| **Total** | **~$110–380** |

Redis is optional at Phase 0; an in-process cache is enough for one user, and
Memorystore can be added later if it's actually needed.

---

## 6. Risk, capital structure, and taxes

**Capital structure (proposal, Pete's call).** Split the $100k into a **core sleeve**
(~$70k) run at the conservative regime-driven risk budget, and an **aggressive
sleeve** (~$30k) where leveraged and options positions live. The aggressive sleeve
is where the 10x math actually plays out; the core sleeve is what keeps the program
running — and generating attribution data — through a bad quarter. If the
aggressive sleeve goes to zero, the system survives and we learn why.

**Ruin budget.** Before the first real trade, write down the number you are
genuinely willing to lose in full. The dashboard tracks distance to it. This is a
one-line entry in the config, and it's the most useful line in the repo.

**Taxes — worth deciding before Phase 4, not after.** Every position here is held
under a week, so every gain is short-term and taxed as ordinary income. At the
returns being targeted the drag is severe: a 10x gross in a taxable account is
dramatically less after federal and state short-term rates, and wash-sale rules
will complicate re-entering names week after week. If any of this capital can sit
in a Roth or traditional IRA, the same strategy compounds tax-free — at a 10x target
that difference is worth more than any signal in Section 2. Worth a conversation
with your accountant in the next two weeks, because it changes which account Phase 4
points at.

---

## 7. Open decisions

These change what gets built, so they're worth answering early. None of them block
Phase 0.

1. **Instruments.** Stocks and ETFs only, or options too? This determines whether
   the 10x target is arithmetically reachable, and whether we buy Polygon.
2. **Account type.** Taxable, or is IRA/Roth capital available? (See Section 6.)
3. **Broker.** Schwab, Fidelity, IBKR, Tastytrade, Alpaca? Determines how fills get
   imported in Stage 7.
4. **Newsletters.** Which ones do you already subscribe to? That list is the
   starting point for Tier 3.
5. **Subdomain.** Confirm the Meadowlark apex domain — the plan assumes something
   like `trade.<meadowlark-domain>`.
6. **Ruin budget.** The number from Section 6.
