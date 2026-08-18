import { useEffect, useState } from 'react';
import type { AccountSnapshot, EconSeriesSummary, YieldCurveSnapshot } from '@tradeit/shared';
import {
  dataApi,
  schwabApi,
  type CollectorRunDto,
  type RegimeResponse,
  type RiskStatus,
} from '../api/client';
import { RegimePanel } from '../components/RegimePanel';
import { YieldCurveChart, type Series } from '../components/YieldCurveChart';
import { useAuth } from '../context/AuthContext';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Cents matter for prices and P&L, so the account panel uses two decimals. */
const money2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a money string for display, or undefined when the value is unknown. */
function fmtMoney(value: string | null): string | undefined {
  return value === null ? undefined : money2.format(Number(value));
}

/** Undefined means still loading and renders a skeleton; never a zero. */
function Value({ value, className }: { value: string | undefined; className?: string }) {
  if (value === undefined) return <span className="skeleton" aria-label="Loading" />;
  return <span className={className}>{value}</span>;
}

export function Dashboard() {
  const { user, signOut } = useAuth();

  const [curve, setCurve] = useState<YieldCurveSnapshot>();
  const [series, setSeries] = useState<EconSeriesSummary[]>();
  const [risk, setRisk] = useState<RiskStatus>();
  const [account, setAccount] = useState<AccountSnapshot>();
  const [runs, setRuns] = useState<CollectorRunDto[]>();
  const [chart, setChart] = useState<Series[]>();
  const [regime, setRegime] = useState<RegimeResponse>();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string }>();
  const [connecting, setConnecting] = useState(false);

  // Show a one-line result after returning from the Schwab connect flow, then
  // strip the query param so a refresh doesn't repeat the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('schwab');
    if (!outcome) return;
    if (outcome === 'connected') {
      setNotice({ kind: 'ok', text: 'Schwab connected — live account data will load shortly.' });
    } else {
      const reason = params.get('reason');
      setNotice({
        kind: 'bad',
        text: `Schwab connection failed${reason ? ` (${reason})` : ''}. Please try again.`,
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function connectSchwab(): Promise<void> {
    try {
      setConnecting(true);
      window.location.href = await schwabApi.loginUrl();
    } catch {
      setConnecting(false);
      setNotice({
        kind: 'bad',
        text: 'Could not start the Schwab connection — check the server credentials.',
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const [c, s, r, a, cr, rg] = await Promise.all([
        dataApi.yieldCurve(),
        dataApi.series(),
        dataApi.risk(),
        dataApi.account(),
        dataApi.collectorRuns(),
        dataApi.regime(),
      ]);

      if (cancelled) return;
      setCurve(c);
      setSeries(s);
      setRisk(r);
      setAccount(a);
      setRuns(cr);
      setRegime(rg);

      const [two, ten] = await Promise.all([
        dataApi.seriesDetail('DGS2', 365).catch(() => null),
        dataApi.seriesDetail('DGS10', 365).catch(() => null),
      ]);

      if (cancelled) return;

      const built: Series[] = [];
      if (two?.points.length) {
        built.push({
          key: 'DGS2',
          label: '2Y',
          color: 'var(--series-2y)',
          points: two.points.map((p) => ({ date: p.date, value: Number(p.value) })),
        });
      }
      if (ten?.points.length) {
        built.push({
          key: 'DGS10',
          label: '10Y',
          color: 'var(--series-10y)',
          points: ten.points.map((p) => ({ date: p.date, value: Number(p.value) })),
        });
      }
      setChart(built);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const lastRun = runs?.[0];

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="wordmark">Tradeit</h1>
        <div className="topbar-meta">
          <span>{user?.email}</span>
          <button type="button" className="linkish" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {notice && <div className={`banner ${notice.kind === 'ok' ? 'ok' : 'bad'}`}>{notice.text}</div>}

      {/* ---- Stage 0: the call that gates everything downstream ---- */}
      <p className="section-label">Market regime</p>
      <RegimePanel regime={regime} />

      {/* ---- Risk limits: known from config, so they render immediately ---- */}
      <p className="section-label">Risk limits</p>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Capital</div>
          <div className="tile-value">
            <Value value={risk && money.format(risk.limits.startingCapital)} />
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Drawdown budget</div>
          <div className="tile-value">
            <Value value={risk && money.format(risk.limits.maxDrawdown)} />
          </div>
          <div className="tile-note">Hard stop at {risk ? money.format(risk.limits.floor) : '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Weekly target</div>
          <div className="tile-value">
            <Value value={risk && `${(risk.targetWeeklyReturn * 100).toFixed(2)}%`} />
          </div>
          <div className="tile-note">Compounds to $200k in 52 weeks</div>
        </div>
        <div className="tile">
          <div className="tile-label">Equity</div>
          <div className="tile-value">
            {/* Stays a skeleton until Schwab is connected — never a false $0. */}
            <Value value={account?.connected ? (account.totalValue ?? undefined) : undefined} />
          </div>
          <div className="tile-note">
            {!account || account.status === 'CONNECTED'
              ? 'Live'
              : account.status === 'EXPIRED'
                ? 'Login expired — reconnect below'
                : account.status === 'ERROR'
                  ? 'Connection error — see Account'
                  : 'Schwab not connected yet'}
          </div>
        </div>
      </div>

      {/* ---- Schwab account: balance, cash split, and open positions ---- */}
      <p className="section-label">Account</p>
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Schwab</h2>
          <p className="panel-sub">
            {!account
              ? 'Loading…'
              : account.status === 'CONNECTED'
                ? account.asOf
                  ? `As of ${new Date(account.asOf).toLocaleString()}`
                  : 'Connected'
                : account.status === 'EXPIRED'
                  ? 'Login expired'
                  : account.status === 'ERROR'
                    ? 'Connection error'
                    : 'Not connected'}
          </p>
        </div>

        {account && account.status !== 'CONNECTED' && (
          <div style={{ marginTop: 12 }}>
            {account.message && (
              <p className="tile-note" style={{ marginBottom: 12 }}>
                {account.message}
              </p>
            )}
            <button type="button" className="btn" onClick={connectSchwab} disabled={connecting}>
              {connecting
                ? 'Opening Schwab…'
                : account.status === 'EXPIRED'
                  ? 'Reconnect Schwab'
                  : 'Connect Schwab'}
            </button>
          </div>
        )}

        {account?.status === 'CONNECTED' && (
          <>
            <div className="tiles" style={{ marginTop: 16 }}>
              <div className="tile">
                <div className="tile-label">Total value</div>
                <div className="tile-value">
                  <Value value={fmtMoney(account.totalValue)} />
                </div>
              </div>
              <div className="tile">
                <div className="tile-label">Settled cash</div>
                <div className="tile-value">
                  <Value value={fmtMoney(account.settledCash)} />
                </div>
                <div className="tile-note">Available to trade now</div>
              </div>
              <div className="tile">
                <div className="tile-label">Unsettled cash</div>
                <div className="tile-value">
                  <Value value={fmtMoney(account.unsettledCash)} />
                </div>
                <div className="tile-note">Still settling (T+1)</div>
              </div>
            </div>

            {account.positions.length === 0 ? (
              <div className="empty">No open positions.</div>
            ) : (
              <div className="tbl-scroll" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="num">Quantity</th>
                      <th className="num">Avg price</th>
                      <th className="num">Market value</th>
                      <th className="num">Unrealized P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.positions.map((p) => (
                      <tr key={p.symbol}>
                        <td>
                          <strong>{p.symbol}</strong>
                        </td>
                        <td className="num">{p.quantity}</td>
                        <td className="num">{fmtMoney(p.averagePrice) ?? '—'}</td>
                        <td className="num">{fmtMoney(p.marketValue) ?? '—'}</td>
                        <td className={`num ${Number(p.unrealizedPnl) >= 0 ? 'pos' : 'neg'}`}>
                          {fmtMoney(p.unrealizedPnl) ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---- The curve ---- */}
      <p className="section-label">Treasury curve</p>
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">2s10s</h2>
          <p className="panel-sub">{curve?.asOf ? `As of ${curve.asOf}` : 'Awaiting first collection'}</p>
        </div>

        <div className="tiles" style={{ marginTop: 16 }}>
          <div className="tile">
            <div className="tile-label">2-Year</div>
            <div className="tile-value">
              <Value value={curve ? (curve.twoYear ?? '—') : undefined} />
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">10-Year</div>
            <div className="tile-value">
              <Value value={curve ? (curve.tenYear ?? '—') : undefined} />
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Spread</div>
            <div className="tile-value">
              <Value
                value={curve ? (curve.spread ?? '—') : undefined}
                className={curve?.inverted ? 'neg' : 'pos'}
              />
            </div>
            <div className="tile-note">{curve?.inverted ? 'Inverted' : 'Positive'}</div>
          </div>
        </div>

        {chart === undefined ? (
          <div className="empty">Loading…</div>
        ) : chart.length === 0 ? (
          <div className="empty">
            No curve history yet. Run <code>npm run collect</code> once a FRED key is set.
          </div>
        ) : (
          <YieldCurveChart series={chart} />
        )}
      </div>

      {/* ---- Everything the collectors hold ---- */}
      <p className="section-label">Economic series</p>
      {series && series.length === 0 ? (
        <div className="panel">
          <div className="empty">
            Nothing collected yet. Set <code>FRED_API_KEY</code> and run{' '}
            <code>npm run collect</code>.
          </div>
        </div>
      ) : (
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                <th>Series</th>
                <th>Role</th>
                <th className="num">Latest</th>
                <th className="num">1w change</th>
                <th className="num">As of</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {(series ?? []).map((s) => (
                <tr key={s.seriesId}>
                  <td>
                    <strong>{s.seriesId}</strong>
                    <div className="tile-note">{s.title}</div>
                  </td>
                  <td>{s.role}</td>
                  <td className="num">
                    {s.latestValue ?? '—'} {s.units === '%' ? '%' : ''}
                  </td>
                  <td className="num">{s.weekChange ?? '—'}</td>
                  <td className="num">{s.latestDate ?? '—'}</td>
                  <td className="num">{s.pointCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Collector health ---- */}
      <p className="section-label">Collectors</p>
      <div className="panel">
        {lastRun ? (
          <>
            <div className="panel-head">
              <h2 className="panel-title">{lastRun.collector}</h2>
              <p className="panel-sub">
                <span className={lastRun.status === 'SUCCEEDED' ? 'status-ok' : 'status-bad'}>
                  {lastRun.status}
                </span>
                {' · '}
                {lastRun.recordsWritten.toLocaleString()} records ·{' '}
                {new Date(lastRun.startedAt).toLocaleString()}
              </p>
            </div>
            {lastRun.error && <div className="form-error">{lastRun.error}</div>}
          </>
        ) : (
          <div className="empty">No collector has run yet.</div>
        )}
      </div>
    </div>
  );
}
