import { useEffect, useState } from 'react';
import type { AccountSnapshot, EconSeriesSummary, YieldCurveSnapshot } from '@tradeit/shared';
import { dataApi, type CollectorRunDto, type RiskStatus } from '../api/client';
import { YieldCurveChart, type Series } from '../components/YieldCurveChart';
import { useAuth } from '../context/AuthContext';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

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

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const [c, s, r, a, cr] = await Promise.all([
        dataApi.yieldCurve(),
        dataApi.series(),
        dataApi.risk(),
        dataApi.account(),
        dataApi.collectorRuns(),
      ]);

      if (cancelled) return;
      setCurve(c);
      setSeries(s);
      setRisk(r);
      setAccount(a);
      setRuns(cr);

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
            {account && !account.connected ? 'Schwab not connected yet' : 'Live'}
          </div>
        </div>
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
