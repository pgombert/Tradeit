import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PortfolioSnapshot } from '@tradeit/shared';
import { dataApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(value: string | null, whole = false): string | undefined {
  if (value === null) return undefined;
  return (whole ? money : money2).format(Number(value));
}
function pct(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}
function shares(value: string): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Undefined means still loading and renders a skeleton; never a zero. */
function Value({ value, className }: { value: string | undefined; className?: string }) {
  if (value === undefined) return <span className="skeleton" aria-label="Loading" />;
  return <span className={className}>{value}</span>;
}

const STATUS_NOTE: Record<PortfolioSnapshot['status'], string> = {
  CONNECTED: '',
  DISCONNECTED: 'Schwab isn’t connected yet — connect it on the dashboard to see your positions.',
  CHOOSE_ACCOUNT: '',
  EXPIRED: 'Your Schwab login has expired. Reconnect it on the dashboard to refresh your positions.',
  ERROR: 'Schwab was reachable but returned an error.',
};

export function Portfolio() {
  const { user, signOut } = useAuth();
  const [snap, setSnap] = useState<PortfolioSnapshot>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    dataApi
      .portfolio()
      .then((p) => {
        if (!cancelled) setSnap(p);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your portfolio just now — try again shortly.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = snap?.status === 'CONNECTED';
  const positions = snap?.positions ?? [];

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="wordmark">Portfolio</h1>
        <div className="topbar-meta">
          <Link to="/" className="linkish">
            ← Dashboard
          </Link>
          <Link to="/brief" className="linkish">
            Weekly brief →
          </Link>
          <span>{user?.email}</span>
          <button type="button" className="linkish" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <p className="page-intro">
        Every position across all your connected Schwab accounts, in one place — holdings held in
        more than one account are combined.
        {snap?.asOf && (
          <span className="muted"> As of {new Date(snap.asOf).toLocaleString()}.</span>
        )}
      </p>

      {error && <div className="panel"><div className="empty">{error}</div></div>}

      {snap && !connected && !error && (
        <div className="panel">
          <div className="empty">{STATUS_NOTE[snap.status] || snap.message || 'Not connected.'}</div>
        </div>
      )}

      {connected && (
        <>
          {/* ---- Summary tiles ---- */}
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Total value</div>
              <Value value={fmtMoney(snap!.totalValue, true)} className="tile-value" />
              <p className="tile-note">positions + cash, all accounts</p>
            </div>
            <div className="tile">
              <div className="tile-label">Invested</div>
              <Value value={fmtMoney(snap!.investedValue, true)} className="tile-value" />
              <p className="tile-note">{positions.length} holdings</p>
            </div>
            <div className="tile">
              <div className="tile-label">Accounts</div>
              <Value value={String(snap!.accounts.length)} className="tile-value" />
              <p className="tile-note">{snap!.accounts.map((a) => a.label).join(', ')}</p>
            </div>
          </div>

          {/* ---- Positions ---- */}
          <p className="section-label">All positions</p>
          {positions.length === 0 ? (
            <div className="panel"><div className="empty">No positions in these accounts.</div></div>
          ) : (
            <div className="panel">
              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="num">Shares</th>
                      <th className="num">Avg cost</th>
                      <th className="num">Market value</th>
                      <th className="num">Gain / loss</th>
                      <th className="num">% of book</th>
                      <th>Held in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const pnl = Number(p.unrealizedPnl);
                      return (
                        <tr key={p.symbol}>
                          <td>
                            <strong>{p.symbol}</strong>
                            {p.description && <span className="co-name">{p.description}</span>}
                          </td>
                          <td className="num">{shares(p.quantity)}</td>
                          <td className="num">{money2.format(Number(p.averagePrice))}</td>
                          <td className="num">{money.format(Number(p.marketValue))}</td>
                          <td className={`num ${pnl >= 0 ? 'pos' : 'neg'}`}>
                            {pnl >= 0 ? '+' : ''}
                            {money.format(pnl)}
                          </td>
                          <td className="num">{pct(p.weight)}</td>
                          <td>
                            {p.accounts.map((a) => (
                              <span key={a} className="chip" style={{ marginRight: 4 }}>
                                {a}
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
