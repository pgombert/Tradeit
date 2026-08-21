import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HoldingAction, MorningReview } from '@tradeit/shared';
import { dataApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function pct(fraction: number | null, decimals = 1): string {
  if (fraction === null) return '—';
  return `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(decimals)}%`;
}

const ACTION_TONE: Record<HoldingAction, string> = {
  EXIT: 'tone-critical',
  TRIM: 'tone-warn',
  HOLD: 'tone-good',
};
const ACTION_LABEL: Record<HoldingAction, string> = { EXIT: 'Exit', TRIM: 'Trim', HOLD: 'Hold' };

export function MorningCheck() {
  const { user, signOut } = useAuth();
  const [review, setReview] = useState<MorningReview | null>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    dataApi
      .morningReview()
      .then((r) => {
        if (!cancelled) setReview(r);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the morning check just now — try again shortly.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="wordmark">Morning Check</h1>
        <div className="topbar-meta">
          <Link to="/portfolio" className="linkish">
            Portfolio →
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
        Every holding run through the momentum rules against this morning's data — a Hold, Trim, or
        Exit call with the reasons. Advisory only; you place every order.
        {review?.generatedAt && (
          <span className="muted"> Last run {new Date(review.generatedAt).toLocaleString()}.</span>
        )}
      </p>

      {error && <div className="panel"><div className="empty">{error}</div></div>}

      {review === null && !error && (
        <div className="panel">
          <div className="empty">
            No morning check has been generated yet. It runs automatically before the open each
            weekday.
          </div>
        </div>
      )}

      {review && !review.connected && (
        <div className="panel"><div className="empty">{review.note}</div></div>
      )}

      {review && review.connected && (
        <>
          {/* ---- Summary ---- */}
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Needs attention</div>
              <span className="tile-value">
                {review.summary.exit + review.summary.trim}
              </span>
              <p className="tile-note">
                {review.summary.exit} exit, {review.summary.trim} trim
              </p>
            </div>
            <div className="tile">
              <div className="tile-label">Holding</div>
              <span className="tile-value">{review.summary.hold}</span>
              <p className="tile-note">trend intact — let them run</p>
            </div>
            <div className="tile">
              <div className="tile-label">Market regime</div>
              <span className="tile-value" style={{ fontSize: '1.2rem' }}>
                {review.regime.replace(/_/g, ' ').toLowerCase()}
              </span>
              <p className="tile-note">sets how the rules read risk</p>
            </div>
          </div>

          {/* ---- Holdings ---- */}
          <p className="section-label">Every holding</p>
          {review.items.length === 0 ? (
            <div className="panel"><div className="empty">No positions to check.</div></div>
          ) : (
            <div className="review-list">
              {review.items.map((it) => (
                <div key={it.symbol} className={`review-card ${it.verdict.action.toLowerCase()}`}>
                  <div className="review-head">
                    <div className="review-name">
                      <strong>{it.symbol}</strong>
                      {it.name && <span className="co-name">{it.name}</span>}
                    </div>
                    <span className={`chip ${ACTION_TONE[it.verdict.action]}`}>
                      {ACTION_LABEL[it.verdict.action]}
                    </span>
                  </div>

                  <ul className="review-reasons">
                    {it.verdict.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>

                  <div className="review-facts">
                    <span><span className="fk">Value</span> {money.format(Number(it.marketValue))}</span>
                    <span><span className="fk">% book</span> {(it.weight * 100).toFixed(0)}%</span>
                    <span className={Number(it.gainFromCost) >= 0 ? 'pos' : 'neg'}>
                      <span className="fk">Since cost</span> {pct(it.gainFromCost)}
                    </span>
                    <span><span className="fk">1-wk</span> {pct(it.return1w)}</span>
                    <span><span className="fk">1-mo</span> {pct(it.return1m)}</span>
                    {it.verdict.roomToStop !== null && (
                      <span className={it.verdict.roomToStop <= 0 ? 'neg' : ''}>
                        <span className="fk">Room to stop</span> {pct(it.verdict.roomToStop, 1)}
                      </span>
                    )}
                    {it.accounts.length > 0 && (
                      <span><span className="fk">In</span> {it.accounts.join(', ')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
