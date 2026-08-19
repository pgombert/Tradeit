import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AnalysedCandidate,
  AttributionSummary,
  Candidate,
  DossierRegime,
  SizedPosition,
  StoredBrief,
} from '@tradeit/shared';
import { briefApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Whole-dollar money — position values, budgets, capital. */
const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Cents matter for the decision triggers, so entry/stop/target use two decimals. */
const money2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A fraction (0.06) shown as a percent (6%). */
function pct(fraction: number, decimals = 0): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Undefined means still loading and renders a skeleton; never a zero. */
function Value({ value, className }: { value: string | undefined; className?: string }) {
  if (value === undefined) return <span className="skeleton" aria-label="Loading" />;
  return <span className={className}>{value}</span>;
}

const REGIME_LABEL: Record<DossierRegime['regime'], string> = {
  RISK_ON_TREND: 'Risk-On Trend',
  CHOP: 'Chop',
  RISK_OFF: 'Risk-Off',
  CRISIS: 'Crisis',
};

/** State is in the chip's tone class (colour + marker), never colour alone. */
const REGIME_TONE: Record<DossierRegime['regime'], string> = {
  RISK_ON_TREND: 'tone-good',
  CHOP: 'tone-warn',
  RISK_OFF: 'tone-orange',
  CRISIS: 'tone-critical',
};

const BREAKER_TONE: Record<StoredBrief['portfolio']['breaker'], string> = {
  NONE: 'tone-neutral',
  HALVE_SIZE: 'tone-warn',
  PAUSE_AND_REVIEW: 'tone-critical',
  HARD_STOP: 'tone-critical',
};

const BREAKER_TEXT: Record<StoredBrief['portfolio']['breaker'], string> = {
  NONE: 'All clear',
  HALVE_SIZE: 'Halved size',
  PAUSE_AND_REVIEW: 'Paused',
  HARD_STOP: 'Hard stop',
};

/** Conviction as up-to-five filled stars, with the number read out for screens. */
function Stars({ conviction }: { conviction: number }) {
  const filled = Math.max(0, Math.min(5, conviction));
  return (
    <span className="stars" aria-label={`Conviction ${filled} of 5`} title={`Conviction ${filled} of 5`}>
      <span aria-hidden="true">{'★'.repeat(filled)}</span>
      <span aria-hidden="true" className="stars-empty">
        {'☆'.repeat(5 - filled)}
      </span>
    </span>
  );
}

/** Bullish/Bearish shown as a toned word — colour plus the word, never colour alone. */
function DirectionTag({ direction }: { direction: SizedPosition['direction'] }) {
  const bull = direction === 'BULLISH';
  return <span className={bull ? 'pos' : 'neg'}>{bull ? 'Bullish' : 'Bearish'}</span>;
}

function PositionsTable({ positions }: { positions: SizedPosition[] }) {
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Direction</th>
            <th>Conviction</th>
            <th className="num">% Book</th>
            <th className="num">Shares</th>
            <th className="num">Position</th>
            <th className="num">Entry</th>
            <th className="num">Init. stop</th>
            <th className="num">Risk</th>
            <th>Exit plan</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={`${p.symbol}-${p.instrument}`}>
              <td>
                <strong>
                  {p.symbol}
                  {p.instrument !== p.symbol && (
                    <>
                      {' '}
                      <span className="muted-arrow">{'→'}</span> {p.instrument}
                    </>
                  )}
                </strong>
                {p.leveraged && <span className="tag">leveraged</span>}
              </td>
              <td>
                <DirectionTag direction={p.direction} />
              </td>
              <td>
                <Stars conviction={p.conviction} />
              </td>
              <td className="num">{Math.round(p.weight * 100)}%</td>
              <td className="num">{p.shares.toLocaleString()}</td>
              <td className="num">{money.format(p.positionValue)}</td>
              <td className="num">{money2.format(p.entry)}</td>
              <td className="num">{money2.format(p.stop)}</td>
              <td className="num">{money.format(p.riskDollars)}</td>
              <td className="exit-plan">{p.trailRule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerdictCard({ item }: { item: AnalysedCandidate }) {
  const { analyst, redTeam, survived } = item;
  return (
    <div className={`verdict-card ${survived ? '' : 'killed'}`}>
      <div className="verdict-head">
        <strong className="verdict-symbol">{analyst.symbol}</strong>
        <DirectionTag direction={analyst.direction} />
        <Stars conviction={analyst.conviction} />
        <span className={`chip ${survived ? 'tone-good' : 'tone-critical'}`}>
          {survived ? 'Survived' : 'Killed'}
        </span>
      </div>
      <p className="verdict-thesis">{analyst.thesis}</p>
      <p className="tile-note verdict-wrong">
        <strong>Would be wrong if:</strong> {analyst.whatWouldProveWrong}
      </p>
      {!survived && redTeam.causeOfDeath && (
        <p className="verdict-death">
          <strong>Cause of death:</strong> {redTeam.causeOfDeath}
        </p>
      )}
    </div>
  );
}

export function Brief() {
  const { user, signOut } = useAuth();
  const [brief, setBrief] = useState<StoredBrief>();
  const [track, setTrack] = useState<AttributionSummary>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    briefApi
      .latest()
      .then((b) => {
        if (!cancelled) setBrief(b);
      })
      .catch(() => {
        if (!cancelled)
          setError("Couldn't load this week's brief. It may not have been generated yet — try again shortly.");
      });
    briefApi
      .attribution()
      .then((t) => {
        if (!cancelled) setTrack(t);
      })
      .catch(() => {
        /* Track record is supplementary — a failure here shouldn't blank the brief. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const portfolio = brief?.portfolio;
  const survivors = brief?.analysed.filter((a) => a.survived) ?? [];
  const killed = brief?.analysed.filter((a) => !a.survived) ?? [];

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="wordmark">Weekly Brief</h1>
        <div className="topbar-meta">
          <Link to="/" className="linkish">
            {'←'} Dashboard
          </Link>
          <span>{user?.email}</span>
          <button type="button" className="linkish" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* ---- Header: date, generated time, regime badge ---- */}
      <div className="brief-headline">
        <div>
          <div className="section-label" style={{ margin: '24px 0 4px' }}>
            Week of
          </div>
          <div className="tile-value">
            <Value value={brief?.asOf} />
          </div>
          <p className="panel-sub" style={{ marginTop: 4 }}>
            {brief ? `Generated ${new Date(brief.generatedAt).toLocaleString()}` : ' '}
          </p>
        </div>
        {brief && (
          <div className="brief-regime">
            <span className={`chip ${REGIME_TONE[brief.regime.regime]}`}>
              {REGIME_LABEL[brief.regime.regime]}
            </span>
            <span className="tile-note">
              {brief.regime.leverageAllowed ? 'Leverage permitted' : 'Leverage off'} {'·'} Risk
              budget {pct(brief.regime.riskBudget, 1)}
            </span>
          </div>
        )}
      </div>

      {error && <div className="banner bad">{error}</div>}

      {brief && !brief.aiRan && (
        <div className="notice" role="note">
          <strong>Rules-only preview.</strong> The AI analyst hasn&apos;t run yet, so these are the
          screen results without a written thesis or a red-team check.
        </div>
      )}

      {/* ---- 1. The trades ---- */}
      <p className="section-label">The trades</p>
      <div className="panel">
        <div className="tiles" style={{ marginTop: 0 }}>
          <div className="tile">
            <div className="tile-label">Book deployed</div>
            <div className="tile-value">
              <Value value={portfolio && pct(portfolio.deployFraction, 0)} />
            </div>
            <div className="tile-note">Share of the $100k put to work</div>
          </div>
          <div className="tile">
            <div className="tile-label">Capital deployed</div>
            <div className="tile-value">
              <Value value={portfolio && money.format(portfolio.capitalDeployed)} />
            </div>
          </div>
          <div className="tile">
            <div className="tile-label">Leveraged sleeve</div>
            <div className="tile-value">
              <Value value={portfolio && pct(portfolio.leveragedFraction, 1)} />
            </div>
            <div className="tile-note">Share of book in leveraged vehicles</div>
          </div>
          <div className="tile">
            <div className="tile-label">Circuit breaker</div>
            <div className="tile-value" style={{ fontSize: '1rem', marginTop: 4 }}>
              {portfolio ? (
                <span className={`chip ${BREAKER_TONE[portfolio.breaker]}`}>
                  {BREAKER_TEXT[portfolio.breaker]}
                </span>
              ) : (
                <span className="skeleton" aria-label="Loading" />
              )}
            </div>
          </div>
        </div>

        {portfolio && portfolio.positions.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <PositionsTable positions={portfolio.positions} />
          </div>
        )}

        {portfolio && portfolio.positions.length === 0 && (
          <div className="empty">
            No trades this week.
            {portfolio.notes.length > 0 && ` ${portfolio.notes[0]}`}
          </div>
        )}

        {!portfolio && <div className="empty">Loading{'…'}</div>}

        {portfolio && portfolio.notes.length > 0 && (
          <ul className="brief-notes">
            {portfolio.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}

        {portfolio && portfolio.watchlist.length > 0 && (
          <div className="watchlist">
            <div className="watchlist-label">Sat out — reports earnings inside the hold (revisit after):</div>
            <ul className="brief-notes">
              {portfolio.watchlist.map((w) => (
                <li key={w.symbol}>
                  <strong>{w.symbol}</strong> — {w.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ---- 2. The analysis ---- */}
      <p className="section-label">The analysis</p>
      {!brief ? (
        <div className="panel">
          <div className="empty">Loading{'…'}</div>
        </div>
      ) : brief.analysed.length === 0 ? (
        <div className="panel">
          <div className="empty">
            The AI analyst hasn&apos;t run yet — no written verdicts for this week.
          </div>
        </div>
      ) : (
        <>
          {survivors.length > 0 && (
            <div className="verdict-grid">
              {survivors.map((a) => (
                <VerdictCard key={a.analyst.symbol} item={a} />
              ))}
            </div>
          )}
          {killed.length > 0 && (
            <>
              <p className="section-label" style={{ marginTop: 24 }}>
                Killed by the red team
              </p>
              <div className="verdict-grid">
                {killed.map((a) => (
                  <VerdictCard key={a.analyst.symbol} item={a} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ---- From the feed (news-driven discovery) ---- */}
      {brief && brief.narrativeIdeas.length > 0 && (
        <>
          <p className="section-label">From the feed</p>
          <div className="panel">
            <p className="tile-note" style={{ marginTop: 0 }}>
              Names your newsletters and podcasts are talking about with momentum right now.
            </p>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Conviction</th>
                    <th>In the book?</th>
                    <th>Why it surfaced</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.narrativeIdeas.map((idea) => (
                    <tr key={idea.symbol}>
                      <td>
                        <strong>{idea.symbol}</strong>
                      </td>
                      <td>
                        <Stars conviction={Math.max(1, Math.min(5, idea.confidence)) as 1 | 2 | 3 | 4 | 5} />
                      </td>
                      <td>
                        {idea.inBook ? (
                          <span className="chip tone-pos">In the book</span>
                        ) : (
                          <span className="chip">Idea only</span>
                        )}
                      </td>
                      <td className="exit-plan">{idea.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---- Track record (the self-learning scorecard) ---- */}
      <p className="section-label">Track record</p>
      <div className="panel">
        <p className="tile-note" style={{ marginTop: 0 }}>
          How the system's own past picks have done since it named them — graded against
          the latest prices. This sharpens as more briefs age; a pick made today hasn't
          moved yet.
        </p>
        {track && track.picks > 0 ? (
          <>
            <div className="tiles" style={{ marginBottom: 16 }}>
              <div className="tile">
                <div className="tile-label">Picks graded</div>
                <Value value={String(track.picks)} className="tile-value" />
                <p className="tile-note">across {track.gradedBriefs} briefs</p>
              </div>
              <div className="tile">
                <div className="tile-label">Hit rate</div>
                <Value value={track.hitRate == null ? undefined : pct(track.hitRate)} className="tile-value" />
                <p className="tile-note">share of picks now in the green</p>
              </div>
              <div className="tile">
                <div className="tile-label">Avg. move</div>
                <Value
                  value={track.avgReturn == null ? undefined : pct(track.avgReturn, 1)}
                  className={`tile-value ${(track.avgReturn ?? 0) >= 0 ? 'pos' : 'neg'}`}
                />
                <p className="tile-note">mean return since each entry</p>
              </div>
            </div>
            {track.byScreen.length > 0 && (
              <div className="tbl-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Signal</th>
                      <th>Picks</th>
                      <th>Hit rate</th>
                      <th>Avg. move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {track.byScreen.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key}</td>
                        <td>{row.picks}</td>
                        <td>{row.hitRate == null ? '—' : pct(row.hitRate)}</td>
                        <td className={(row.avgReturn ?? 0) >= 0 ? 'pos' : 'neg'}>
                          {row.avgReturn == null ? '—' : pct(row.avgReturn, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            No graded picks yet — the scorecard fills in as this week's book ages.
          </div>
        )}
      </div>

      {/* ---- 3. All candidates ---- */}
      <p className="section-label">All candidates</p>
      {!brief ? (
        <div className="panel">
          <div className="empty">Loading{'…'}</div>
        </div>
      ) : brief.candidates.length === 0 ? (
        <div className="panel">
          <div className="empty">No candidates surfaced by the screens this week.</div>
        </div>
      ) : (
        <div className="tbl-scroll">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Exposure</th>
                <th>Direction</th>
                <th>Conviction</th>
                <th>Surfaced by</th>
              </tr>
            </thead>
            <tbody>
              {brief.candidates.map((c: Candidate) => (
                <tr key={c.symbol}>
                  <td>
                    <strong>{c.symbol}</strong>
                  </td>
                  <td>{c.exposure}</td>
                  <td>
                    <DirectionTag direction={c.direction} />
                  </td>
                  <td>
                    <Stars conviction={c.conviction} />
                  </td>
                  <td>{c.screens.map((s) => s.screen).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
