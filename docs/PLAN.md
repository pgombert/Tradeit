# Tradeit — Build Plan

**Owner:** Pete Gombert (sole user, sole decision-maker)
**Repo:** `pgombert/Tradeit`
**Deploys to:** `https://trade.meadowlark.day` (dedicated GCP project `tradeit-505723`)
**Status:** Rev 5, 2026-08-17. **Deployed and live.** Phase 0 shipped; Phase 1
collectors underway (see §9).

---

## Locked decisions

| | |
|---|---|
| **Instruments** | Stocks and ETFs only. No options. |
| **Account** | Schwab retirement account |
| **Broker** | Charles Schwab — Trader API, free with the account |
| **Capital** | $100,000 |
| **Target** | $200,000 in one year — +100%, or **+1.34% per week** |
| **Max drawdown** | **$30,000** — hard floor at $70,000 |
| **Newsletters** | None yet — starting set proposed in §3 |
| **Domain** | `trade.meadowlark.day` — live, TLS valid, `/api/**` → Cloud Run |

Three of these have consequences that reshape the system. They're worked through in
§1 (what we can actually trade), §2 (what the account permits), and §3 (sources).

---

## 0. What this is, and what it is not

**It is a research pipeline.** Market data, economic releases, SEC filings,
research letters, sentiment and positioning gauges — all normalized into one
timestamped store. From that store it builds a compact dossier per candidate, asks
Claude for a verdict, then runs a second pass whose only job is to kill that
verdict. What survives lands in a Sunday brief.

**It is not an execution system.** Schwab's API can place orders; we will not wire
that path. Claude is a research analyst here, not an adviser and not a fiduciary.
Pete reads the brief, decides, and enters every order himself.

---

## 1. The target, and what it now requires

**$100k → $200k in a year is +1.34% per week**, compounded across 52 weeks
(2^(1/52) − 1). Dropping from 10x to 2x moves this out of the tail of the
distribution and into the range a disciplined system can actually be built for. It
also changes the design, not just the number on the dashboard.

### What the earlier target demanded, and no longer does

At 3x on a broad index a *perfect* forecaster earns roughly 4.5% a week, because
SPY's typical absolute weekly move is about 1.5%. The 10x target was 4.53% a week —
so a 100% hit rate landed at the target before costs and below it after. Leverage
wasn't optional there; it was the only way the arithmetic closed at all.

At +1.34% a week, that pressure is gone. Here's what actually clears the bar:

| Approach | Payoff shape | Hit rate needed |
|---|---|---|
| 3x index, full deployment | symmetric ±4.5% | **65%** |
| Any instrument, tight stops | +4% / −2% | **56%** |
| Any instrument, wider runners | +6% / −2% | **42%** |

That last row is the important one. A 42% hit rate with a 3:1 payoff is an ordinary
trend-following profile, not an exceptional one — and it clears +100% a year. So:

1. **Payoff asymmetry is still the primary return driver.** Cutting losers fast and
   letting winners run does more work than being right more often. The stop
   discipline in Stage 5 is the engine, not the safety rail. Build it first, tune it
   hardest.
2. **Leverage becomes optional.** An unleveraged book of liquid equities and sector
   ETFs, run with real stop discipline, can plausibly reach +1.34% a week. Leveraged
   products become a way to reach the target with *less* capital deployed rather
   than a requirement to reach it at all.

To be clear about the ambition: +100% a year is still roughly ten times the S&P's
long-run average and would be a strong year for a professional fund. It is hard. It
is no longer arithmetically cornered.

### Consequences of the change

**Leverage gets capped instead of centered.** The earlier plan proposed a core
sleeve and an aggressive sleeve. That split is now unnecessary complexity. Replace
it with a single rule in Stage 5: **leveraged products are eligible only in the
Risk-On Trend regime, and never exceed 20% of book.** Simpler, and it closes the
open question the previous revision left hanging.

**Financing drag now matters proportionally more.** A 3x fund finances 2x the
notional at roughly SOFR plus a spread, on top of a ~0.9% expense ratio — 8–11% a
year. Against a 900% target that was noise. Against a 100% target it's a tenth of
the whole objective, which is a second independent reason to use leveraged products
selectively rather than as the default expression.

**The circuit breakers become real.** At the old target the −10% / −20% / −30%
breakers were nominal, because you had to keep swinging regardless. At +1.34% a week
they're genuinely protective, and a −25% drawdown no longer means the year is lost —
recovering it costs about six months of on-target performance rather than being
mathematically out of reach.

**The drawdown limit is $30,000.** Set 2026-08-16. That maps cleanly onto the
existing breaker ladder in thirds, so the numbers in Stage 5 are no longer
arbitrary percentages — they are stops on the way to a floor Pete chose:

| Equity | Drawdown | What happens |
|---|---|---|
| $90,000 | $10,000 | Next week's position sizes halve |
| $80,000 | $20,000 | Trading pauses for a week; full review |
| **$70,000** | **$30,000** | **Hard stop. Program ends, rebuild from scratch.** |

Recovering a $20k drawdown costs about six months of on-target performance — real,
but not fatal. This lives in code in `packages/shared/src/types/risk.ts` and is
driven by `STARTING_CAPITAL` and `MAX_DRAWDOWN` in the environment, so the engine
and the dashboard cannot drift apart.

### The leveraged universe, when it is used

- **Index:** TQQQ / SQQQ, UPRO / SPXU, TNA / TZA
- **Sector:** SOXL / SOXS (semis), LABU / LABD (biotech), FAS / FAZ (financials)
- **Unleveraged inverse**, for a bearish tilt without 3x: SH, PSQ, RWM
- **Single-stock 2x** (NVDL, TSLL) — permitted, but most fail the liquidity floor

Mechanics the risk engine models regardless:

- **Daily reset means path dependency.** Over five trading days in a trending tape
  the drag is small; in a chopping tape it compounds against you regardless of
  direction. **The regime classifier gates leveraged products entirely — none in
  "Chop."**
- **Liquidity floor.** Nothing below ~$5M average daily dollar volume. Most
  single-stock leveraged ETFs fail this and carry punishing spreads.
- **Schwab paperwork.** Schwab requires an acknowledgment before trading leveraged
  and inverse products. Sign it in Phase 0, not in week 5.

---

## 2. What the retirement account permits

Good news first: **every gain compounds tax-free.** The entire short-term capital
gains drag from the first draft is gone, and wash-sale tracking becomes irrelevant
inside the account. At weekly turnover that is worth more than any single data
source in §3.

Four constraints follow from the account type, and each has a build consequence:

| Constraint | Consequence |
|---|---|
| **No short selling** in an IRA | Every bearish thesis is expressed as a *long* position in an inverse ETF (SQQQ, SPXU, SH). The engine emits direction, then translates to an instrument — the trade list never contains a short. |
| **No margin borrowing** | Position sizing works against settled capital only. No leverage beyond what's inside the ETF wrapper. |
| **Cash account, T+1 settlement** | Sell Monday, proceeds settle Tuesday. With weekly holds this mostly works, but a mid-week rotation can trip a good-faith violation. **Apply for Schwab's "limited margin" on the IRA in Phase 0** — it permits trading unsettled proceeds without borrowing, and removes the whole class of problem. The ledger tracks settled vs. unsettled cash either way. |
| **Contributions are capped** | An IRA balance lost is tax-advantaged space that can only be refilled at roughly $7–8k a year. Noting it once as a fact, not as an argument — you've made the call. |

### Schwab Trader API — a meaningful simplification

Schwab includes API access free with the account, in two halves: **Accounts &
Trading** (positions, balances, orders) and **Market Data** (quotes, price history,
movers). That covers both the price feed *and* automatic fill import, which
collapses two line items from the first draft:

- **Alpaca is no longer needed** for market data — Schwab's feed is the same data
  the account trades against, which is better for reconciliation.
- **Stage 7 fill entry becomes automatic** rather than manual or CSV-imported.

Setup: register as an Individual Developer at `developer.schwab.com`, create an app,
wait for "Ready for use" status. Individual access against your own account is the
supported path; nothing about this requires commercial approval. OAuth 2.0, and the
refresh token needs re-authorization periodically — the collector must handle that
expiry gracefully rather than silently going stale.

**We request read scopes only.** The trading endpoints exist; we don't call them.

---

## 3. Sources — the starting set

You have no newsletters today, so this is a proposal to test rather than a list to
trust. Each one enters as a candidate, and §5's attribution engine decides by
week 10 which ones earned their place.

### First, a word on the paid alert-service market

Search for "best swing trading newsletters" and you get Motley Fool Stock Advisor,
Stock Market Guides, Mindful Trader and similar, with headline track records like
"+421% since 2022" or "beat the S&P by 4.9x." Two things about those numbers: they
are self-reported and not independently audited, and the ranking sites publishing
them are affiliate-compensated for the signups. That doesn't prove they're
worthless — it means their claimed edge is unverifiable from outside, which is
precisely the thing this system was built to fix. If you want them in, add them as
Tier 3 candidates and let the attribution data decide at your own expense. I
wouldn't start there.

The sources below were picked for a different property: they publish *reasoning and
data* rather than picks, which is what a dossier can actually use.

### Macro and regime — feeds Stage 0

| Source | Why | Cost |
|---|---|---|
| **Apollo — Daily Spark** (Torsten Slok) | Daily, chart-driven, genuinely good macro. No product to sell you. | Free |
| **Verdad Weekly Research** (Dan Rasmussen) | Quantitative, rigorous, publishes its methodology and its misses. Among the best free research anywhere. | Free |
| **Liz Ann Sonders & Kathy Jones** (Schwab) | Equities and rates respectively. Already yours as a Schwab client. | Free |
| **Calculated Risk** (Bill McBride) | Housing and employment, long track record of calling turns early. | Free / ~$60yr |
| **Topdown Charts** (Callum Thomas) | Breadth, valuation and sentiment charts, weekly cadence. | Free tier |

### Market internals and positioning — feeds Stage 0 and Stage 1

| Source | Why | Cost |
|---|---|---|
| **SentimenTrader** | Quantified sentiment and breadth studies published as *historical base rates* — "when this setup occurred, here's the distribution of forward returns." That's already dossier-shaped. The single best fit for this system. | ~$100/mo |
| **Bespoke Investment Group** | Data-driven, honest about misses, strong seasonality and breadth work. | ~$100/mo |
| **Quantifiable Edges** (Rob Hanna) | Statistical short-term edges at exactly this holding period. | ~$60/mo |
| **SpotGamma** or **Menthor Q** | Dealer options positioning. Relevant even though we trade no options — dealer gamma drives index behavior week to week, which is what the leveraged positions ride. | $100–250/mo |

### Catalysts and earnings — feeds Stage 1

| Source | Why | Cost |
|---|---|---|
| **The Transcript** | Weekly digest of what management actually said on earnings calls. Genuinely differentiated primary-source aggregation. | Free / cheap |
| **Earnings Whispers** | Calendar and whisper numbers. | Free tier |

### Factor research — shapes the screens, not the weekly picks

**Alpha Architect** blog, and **AQR** / **Research Affiliates** publications. All
free, all peer-reviewed-adjacent. These inform how Stage 1 screens are built rather
than feeding any individual week.

### Machine-readable crowd sentiment

Not newsletters, but the same job and free: **StockTwits** sentiment API, and
Reddit mention-volume spikes on r/stocks and r/wallstreetbets. Most useful as a
*crowding* indicator — a contrarian input, not a confirming one.

### Recommended starting configuration

Everything free above, plus **one paid subscription: SentimenTrader** (~$100/mo).
Its output is already structured as base-rate studies, which is exactly what Stage 2
wants to put in front of Claude. Revisit at week 6 with attribution data in hand;
add Bespoke and Quantifiable Edges then if the sentiment inputs are pulling weight.

Ingestion is unchanged from the first draft: a dedicated Gmail account, everything
subscribed to it, pulled through the Gmail API using Meadowlark's existing Google
OAuth plumbing. Personal use only; nothing redistributed.

---

## 4. Architecture

Deliberately the same shape as Tally, Meadowlark, and Nourish.

| Workspace | Stack | Dev port | Purpose |
|---|---|---|---|
| `packages/shared` | TypeScript | — | Shared types (`@tradeit/shared`) |
| `backend` | Express 5 + Prisma + PostgreSQL 16 + Redis | 4002 | API, collectors, engine |
| `frontend` | React 19 + Vite 7 | 3002 | Dashboard and weekly brief |

Ports avoid Tally (3000/4000) and Meadowlark (3001/4001). Postgres 5434, Redis 6381.

**Production.** Cloud Run service `tradeit-api` in `us-central1`; frontend on
Firebase Hosting with `/api/**` rewritten to Cloud Run, per Meadowlark's
`firebase.json`; Cloud SQL Postgres, smallest tier; Google Secret Manager for
secrets; Cloud Scheduler driving Cloud Run *Jobs* for collectors, so a collector
crash can't take the app down; Sentry for errors.

**Auth.** Meadowlark's JWT and Google sign-in, then a hard email allowlist of one.
No signup, no password reset, no invites.

**Standards carried from Tally.** Money is `Decimal` end to end. Multi-table writes
run inside `prisma.$transaction()`. Collectors are idempotent on the source's stable
ID. Never render `$0` while loading. And the one that matters most here:
**anything Claude produces is validated against canonical data before it is stored
or displayed** — tickers must resolve to rows we hold, quoted prices are replaced
with ours, and a verdict citing evidence that doesn't exist is discarded whole.

---

## 5. The engine

One `Observation` table takes every collector's output — source, stable external ID,
scope, observed-at, ingested-at, payload, URL — with structured domains
(`PriceBar`, `EconSeries`, `Filing`, `NewsletterItem`, `Catalyst`) alongside. The
rule this buys: Claude never sees a raw feed, only a curated packet where every line
carries a citable ID.

Data sources by tier: **free** — Schwab market data, FRED (`DGS2`, `DGS10`,
`T10Y2Y`, `ICSA`, `BAMLH0A0HYM2`, NFCI), SEC EDGAR, Treasury/BLS/BEA, Finnhub
earnings calendar, CBOE VIX term structure and put/call, AAII and NAAIM, FINRA short
interest. **Paid, later** — Tiingo Power (~$50/mo) if Schwab's history proves
insufficient for backtesting. Polygon is no longer needed; it was for options.
**Derived in-house** — relative strength, moving averages, ATR, RSI, volume surges,
sector rotation, breadth, realized vs. implied vol, correlation to the book.

The Sunday job chain, unchanged in shape from Rev 1 but now instrument-aware:

**Stage 0 — Regime classification** *(code)*. Trend, VIX level and term structure,
credit spreads, 2s10s, breadth → **Risk-On Trend / Chop / Risk-Off / Crisis**. Sets
the week's risk budget before any candidate is examined, and **gates leveraged
products entirely** — they are eligible only in Risk-On Trend.

**Stage 1 — Candidate generation** *(code)*. 20–40 names with provenance: momentum
leaders, catalysts inside the window, insider clusters, research-letter consensus and
divergence, oversold names in intact uptrends, and sector expressions of the regime
call. Bearish candidates are emitted as *direction*, translated to inverse ETFs at
Stage 5 — never as shorts.

**Stage 2 — Evidence dossier** *(code)*. Per candidate: price and vol stats, every
catalyst in the window, fundamentals, what each source said and when, insider
activity, correlation to the book. Every line carries an observation ID.

**Stage 3 — Analyst pass** *(Claude)*. Structured output: thesis, direction,
conviction, entry zone, stop, target, horizon, catalyst, **what would prove it
wrong**, and the evidence IDs relied on. Then the validation gate above.

**Stage 4 — Red team pass** *(Claude)*. One instruction: kill the thesis. Bear case,
what's priced in, crowding, what the analyst ignored. Survivors advance; the rest are
logged with cause of death, which over time is as valuable as the trades.

**Stage 5 — Portfolio construction** *(code, no AI)*. Fractional Kelly sizing under
a hard per-position cap; correlation and sector caps so five names aren't one bet;
weekly risk bounded by the Stage 0 regime; direction-to-instrument translation
(bearish → inverse ETF); **leveraged products only in Risk-On Trend and never above
20% of book**; settled-cash check against the T+1 ledger. **Every position gets a
stop and a mandatory exit date at entry** — and per §1, the stop is the return
driver, not a safety net, so the default shape is a tight stop against a wider
runner. Circuit breakers: −10% week halves next week's size, −20% from peak pauses
trading for a review, −25% is the drawdown limit proposed in §1, −30% is a full stop
and rebuild.

**Stage 6 — The Sunday brief** *(you)*. Regime call and why, risk budget, ranked
trades with size/entry/stop/exit, what changed, **what we got wrong last week**, open
positions. You approve each line. The click is a record, not a trigger.

**Stage 7 — Logging and attribution** *(code)*. Fills pulled automatically from the
Schwab API. Then the system measures itself: hit rate, average win vs. average loss,
expectancy, drawdown, and critically **alpha per source** and **alpha per signal
type**. Which letter actually predicted anything? Do insider clusters work in this
regime? Is the regime classifier itself right? This is what makes the system improve
rather than merely accumulate.

---

## 6. Build phases

| Phase | Work | Ends with |
|---|---|---|
| **0** | Monorepo, schema, Cloud Run + Cloud SQL + `trade.meadowlark.*`, single-user auth, Schwab API registration, FRED collector. **In parallel, by you:** apply for IRA limited margin, sign the leveraged-ETF acknowledgment, create the newsletter Gmail and subscribe to the §3 free list | Deployed shell showing a live yield curve and Schwab positions |
| **1** | Gmail ingestion, EDGAR, catalyst calendar, sentiment collectors, the `Observation` bus | Every source flowing into one store |
| **2** | Regime engine, screens, dossier builder | First automated Sunday brief — rules only, no AI |
| **3** | Analyst pass, red team pass, validation gate | First full brief |
| **4** | Risk engine, instrument translation, settled-cash ledger, circuit breakers, approval flow | **Paper trading begins** |
| **5–8** | Paper trade live. Attribution dashboard. Backtest the screens against Schwab history. Cut sources that don't earn their place | Four-plus weeks of honest track record |
| **9** | Go / no-go against real numbers | Real capital, if the gate below passes |

### The go/no-go gate, now that the target is a real number

+1.34% a week makes Phase 9 concrete instead of a judgment call. But be clear about
what six weeks of paper trading can and cannot establish: with a weekly standard
deviation around 3%, distinguishing a +1.34%/week system from a flat one at any
statistical confidence takes roughly **six months**, not six weeks. Six data points
cannot prove the return rate.

So the gate is a **process and disaster filter**, not proof of edge:

- Expectancy is positive, and the payoff ratio is at or above 2:1
- Every stop was honored — no widened stops, no "just one more day"
- The regime classifier's calls look defensible in hindsight
- Attribution shows at least one source or signal type contributing something
- No week breached the risk budget

Pass all five and real capital goes in, with the understanding that the first six
*months* are still the real evaluation period and position sizing stays at the low
end until then.

---

## 7. Running cost

| Item | Per month |
|---|---|
| GCP — Cloud Run, Cloud SQL small, Scheduler, Secret Manager | $40–70 |
| Anthropic API — weekly analyst plus red team | $20–60 |
| Schwab Trader API — market data and account access | $0 |
| Free tier — FRED, EDGAR, Finnhub, CBOE, FINRA, AAII, and the §3 free letters | $0 |
| SentimenTrader | $100 |
| **Total** | **$160–230** |

Polygon's $199 is gone with options. Tiingo (~$50) only if Schwab's history proves
too thin for backtesting. Redis is optional at Phase 0.

At the top of that range the stack costs about $2,800 a year — **2.8% of capital,
so roughly three points of the 100% target.** Worth keeping in view when adding a
subscription: a $250/mo data feed has to earn back three points a year before it
contributes anything.

---

## 8. What's still open

Nothing blocking. The domain (`trade.meadowlark.day`), the sleeve question
(replaced by "leveraged products only in Risk-On Trend, capped at 20% of book"),
and the drawdown limit ($30,000) are all closed. Open work is the remaining
Phase 1 collectors — see §9.

---

## 9. Phase 0 — what was built

Committed and running. `npm run dev` brings up the whole thing.

**Monorepo** — `packages/shared` (types, FRED series list, risk maths),
`backend` (Express 5 + Prisma + Postgres, port 4002), `frontend` (React 19 + Vite,
port 3002). Local Postgres 5434, Redis 6381.

**Database** — eight tables: `users`, `securities`, `price_bars`, `econ_series`,
`econ_points`, `observations`, `collector_runs`, plus enums. All money and market
values are `Decimal`. The `observations` table is the signal bus described in §5,
unique on `(source, source_ref)` so every collector is restartable.

**Auth** — email and password with JWT, and a hard allowlist re-checked on every
request, not just at login. No signup route, no password reset, no invites.
`npm run db:seed` creates the one account and prints a generated password once.

**FRED collector** — pulls the twelve series in §5 (curve, credit spreads, VIX,
financial conditions, claims, CPI). Idempotent: upserts on `(series, date)`, and
re-requests a 45-day window behind the last point it holds because FRED revises.
Drops FRED's `"."` placeholder rather than coercing it — a coerced `"."` becomes a
fake zero-yield day in the middle of the curve. Every run is recorded in
`collector_runs` with its record count and any error.

**Dashboard** — risk limits, the 2s10s snapshot and a year of curve history, every
series with its weekly change, and collector health. Values that haven't loaded
render a skeleton, never `$0`.

**Deployment** — `Dockerfile`, `cloudbuild.backend.yaml` (build → push → migrate →
deploy, with a failed migration halting the pipeline), `firebase.json` pointing
`tradeit-prod` at the `tradeit-api` Cloud Run service, and a `tradeit-collect`
Cloud Run Job for the scheduler.

**Verification** — 12 tests pass, every workspace typechecks, the full build is
green, the API was booted and auth exercised end to end, and the dashboard was
screenshotted in light and dark mode. That last step caught two real bugs: a CSS
selector that silently never matched, so the inverted-curve warning colour was
dead, and a missing favicon throwing a console error.

## 9b. Deployed, and Phase 1 so far (2026-08-17)

**Live in production** (`tradeit-505723`, `trade.meadowlark.day`): Cloud SQL
(migrated), the `tradeit-api` service, the `tradeit-migrate` and `tradeit-collect`
jobs, and the weekday collector schedule. First real data has landed — all FRED
series, the earnings calendar, and the VIX-term signal.

**Collectors built and running** (`backend/src/collectors/`, registered in
`jobs/collect.ts`):
- **fred** — the twelve macro series plus `VXVCLS` (3-month VIX), added for term structure.
- **earnings** — Finnhub earnings calendar, next 14 days → `EARNINGS_EVENT` observations.
- **derived** — first in-house signal: VIX term structure (front/back ratio →
  CONTANGO/FLAT/BACKWARDATION, −2..+2), computed from FRED data we already hold.

**The never-trade boundary is machine-enforced.** Schwab's individual Trader API
has no read-only scope, so the credentials can technically place orders. The
guard is code discipline, now backed by a build-breaking test
(`no-order-execution.test.ts`) that fails on any order-placement path or call.

**Credentials in Secret Manager** (all wired into the service, names matching the
code): `FRED_ID`, `FINHUB_APIKEY`, `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`,
`ANTHROPIC_API_KEY`, plus DB/JWT secrets. Note the two hand-created names
(`FRED_ID`, and `FINHUB_APIKEY` — missing an N); the code reads those exact names.

**Next in Phase 1:**
1. **Gmail newsletter ingestion** — the §3 free letters into `NEWSLETTER`/`LETTER_ITEM`.
   Was blocked on the Google project; unblock and build.
2. **SEC EDGAR** — better as an on-demand dossier lookup than a bulk collector,
   since filings are per-candidate; revisit when Stage 2 defines candidates.
3. **Sentiment/positioning** — free sources (NAAIM/AAII/CBOE) have no clean data
   feed (fragile scraping); the plan earmarks paid SentimenTrader for this.
4. **Schwab account reader** — OAuth + `GET /trader/v1/accounts` (read only).
   Needs `SCHWAB_REDIRECT_URI` set to `https://trade.meadowlark.day/api/schwab/callback`.

Deploys run via `gcloud builds submit --config=cloudbuild.backend.yaml .` (build →
migrate → update jobs → deploy). Those commands need an allow rule in
`~/.claude/settings.json` — Claude cannot self-grant them.
