# Tradeit — Build Plan

**Owner:** Pete Gombert (sole user, sole decision-maker)
**Repo:** `pgombert/Tradeit`
**Deploys to:** `trade.meadowlark.*` (GCP project `meadowlark-492419`)
**Status:** Rev 2, 2026-08-16. Decisions locked. Phase 0 ready to start.

---

## Locked decisions

| | |
|---|---|
| **Instruments** | Stocks and ETFs only. No options. |
| **Account** | Schwab retirement account |
| **Broker** | Charles Schwab — Trader API, free with the account |
| **Capital** | $100,000 |
| **Ruin budget** | The full $100,000 |
| **Newsletters** | None yet — starting set proposed in §3 |
| **Domain** | `trade.meadowlark.*` (confirm TLD at Phase 0) |

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

## 1. What "stocks and ETFs only" means for the target

You've accepted the risk and set the ruin budget at the full $100k, so this section
is about mechanics, not caution. But ruling out options changes *where the return
has to come from*, and that has direct design consequences.

### The only leverage available is leveraged ETFs

No options and no margin (see §2) means the sole source of leverage is 2x/3x
exchange-traded products — which are, unambiguously, ETFs and therefore in scope:

- **Index:** TQQQ / SQQQ (3x Nasdaq), UPRO / SPXU (3x S&P), TNA / TZA (3x Russell)
- **Sector:** SOXL / SOXS (3x semis), LABU / LABD (3x biotech), FAS / FAZ (3x
  financials), ERX / ERY (3x energy)
- **Unleveraged inverse**, for bearish tilt without 3x: SH, PSQ, RWM
- **Single-stock 2x** (NVDL, TSLL and similar) — allowed, but see the liquidity
  note below

### The arithmetic, worked through

At 3x on a broad index, a *perfect* forecaster earns about 4.5% a week — SPY's
typical absolute weekly move is roughly 1.5%. The target is 4.53% a week. So on
index products, **a 100% hit rate lands you at the target before costs and below it
after.** Hit rate alone cannot get there. That isn't a discouraging framing; it's a
design constraint, and it points at exactly two levers:

1. **Payoff asymmetry.** Cutting losers at −2% while letting winners run to +8%
   produces the required expectancy at a hit rate in the low 60s. Which means the
   stop discipline in Stage 5 is not risk management bolted on the side — **it is
   the primary return driver.** Build it first, tune it hardest.
2. **Instrument volatility.** Semis move about twice what the S&P does. SOXL's
   typical weekly swing is 9%+, not 4.5%. The aggressive sleeve should therefore
   concentrate in high-beta *sector* 3x products rather than TQQQ and UPRO.

A realistic outcome for a good version of this system is somewhere in the +40% to
+100% annual range. The 10x is a tail of that distribution rather than its center.
The dashboard shows both: expectancy per unit of risk as the headline, the 10x pace
drawn alongside it.

### Leveraged ETF mechanics the risk engine must model

- **Daily reset means path dependency.** Over five trading days in a trending tape
  the drag is small; in a chopping tape it compounds against you regardless of
  direction. **Design rule: the regime classifier gates the leveraged sleeve
  entirely — no 3x positions in "Chop."** This falls straight out of the constraint
  and is one of the most valuable rules in the system.
- **Embedded financing.** A 3x fund finances 2x the notional at roughly SOFR plus a
  spread, on top of a ~0.9% expense ratio — call it 8–11% a year of drag at current
  rates. It goes in the expectancy model explicitly, not as a rounding error.
- **Liquidity floor.** Only leveraged products above ~$5M average daily dollar
  volume. Most single-stock leveraged ETFs fail this and carry punishing spreads.
- **Schwab paperwork.** Schwab requires an acknowledgment before trading leveraged
  and inverse products. Worth signing during Phase 0 so it isn't discovered in
  week 5.

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
| **SpotGamma** or **Menthor Q** | Dealer options positioning. Relevant even though we trade no options — dealer gamma drives index behavior week to week, which is what the leveraged sleeve rides. | $100–250/mo |

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
the week's risk budget before any candidate is examined, and — new in this revision
— **gates the leveraged sleeve entirely**, which is off in Chop.

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
(bearish → inverse ETF, high-conviction + trending regime → sector 3x); settled-cash
check against the T+1 ledger. **Every position gets a stop and a mandatory exit date
at entry** — and per §1, the stop is the return driver, not a safety net. Circuit
breakers: −10% week halves next week's size, −20% from peak pauses trading for a
review, −30% is a full stop and rebuild.

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
| **9** | Go / no-go against real numbers | Real capital, if expectancy is positive |

The paper-trading gate costs about a tenth of the year and is what makes the
attribution data in Stage 7 trustworthy — without it there's no way to tell a bad
system from a bad month when the first drawdown lands.

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

---

## 8. What's still open

1. **The TLD** for `trade.meadowlark.*` — one DNS record, resolved at Phase 0.
2. **Whether the aggressive sleeve exists at all.** §1 argues the return has to come
   from sector 3x products with asymmetric stops. Splitting into a core sleeve and a
   3x sleeve isn't about preserving capital — you've set the ruin budget at the full
   amount — it's about not blowing up in week 6 with no attribution data to show for
   it. Worth deciding before Phase 4, not before Phase 0.
