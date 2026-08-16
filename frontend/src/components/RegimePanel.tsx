import type { RegimeResponse } from '../api/client';

const REGIME_LABEL: Record<RegimeResponse['regime'], string> = {
  RISK_ON_TREND: 'Risk-On Trend',
  CHOP: 'Chop',
  RISK_OFF: 'Risk-Off',
  CRISIS: 'Crisis',
};

/** State is encoded in the chip's form as well as its colour, never colour alone. */
const REGIME_TONE: Record<RegimeResponse['regime'], string> = {
  RISK_ON_TREND: 'tone-good',
  CHOP: 'tone-neutral',
  RISK_OFF: 'tone-warn',
  CRISIS: 'tone-critical',
};

/** A zero contribution is neutral, not mildly good — it gets no tone at all. */
function toneFor(score: number): string {
  if (score > 0) return 'pos';
  if (score < 0) return 'neg';
  return 'neutral';
}

/** −2 … +2 mapped onto a centred bar, so sign reads before magnitude. */
function ScoreBar({ score }: { score: number }) {
  if (score === 0) {
    return (
      <div className="scorebar" aria-hidden="true">
        <div className="scorebar-track" />
      </div>
    );
  }

  const pct = Math.min(100, (Math.abs(score) / 2) * 50);
  const positive = score > 0;

  return (
    <div className="scorebar" aria-hidden="true">
      <div className="scorebar-track">
        <div
          className={`scorebar-fill ${positive ? 'pos' : 'neg'}`}
          style={{
            left: positive ? '50%' : `${50 - pct}%`,
            width: `${pct}%`,
          }}
        />
      </div>
    </div>
  );
}

export function RegimePanel({ regime }: { regime: RegimeResponse | undefined }) {
  if (!regime) {
    return (
      <div className="panel">
        <div className="empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="panel-title">{REGIME_LABEL[regime.regime]}</h2>
          <span className={`chip ${REGIME_TONE[regime.regime]}`}>
            {regime.leverageAllowed ? 'Leverage permitted' : 'Leverage off'}
          </span>
        </div>
        <p className="panel-sub">{regime.asOf ? `As of ${regime.asOf}` : 'No data yet'}</p>
      </div>

      <p style={{ margin: '10px 0 0', color: 'var(--ink-soft)', maxWidth: '68ch' }}>
        {regime.rationale}
      </p>

      <div className="tiles" style={{ marginTop: 18 }}>
        <div className="tile">
          <div className="tile-label">Risk budget</div>
          <div className="tile-value">{(regime.riskBudget * 100).toFixed(1)}%</div>
          <div className="tile-note">of capital at risk this week</div>
        </div>
        <div className="tile">
          <div className="tile-label">Score</div>
          <div className="tile-value">
            <span className={regime.score >= 0 ? 'pos' : 'neg'}>
              {regime.score >= 0 ? '+' : ''}
              {regime.score.toFixed(2)}
            </span>
          </div>
          <div className="tile-note">−2 risk-off … +2 risk-on</div>
        </div>
        <div className="tile">
          <div className="tile-label">Signals</div>
          <div className="tile-value">
            {regime.signals.length}
            <span style={{ color: 'var(--muted)', fontSize: '0.6em' }}>
              {' '}
              / {regime.signals.length + regime.missing.length}
            </span>
          </div>
          <div className="tile-note">
            {regime.missing.length ? `${regime.missing.length} still missing` : 'complete'}
          </div>
        </div>
      </div>

      {regime.cappedByMissingTrend && (
        <div className="notice" role="note">
          <strong>Held at Chop.</strong> The macro readings would support a trend regime, but
          price trend data is missing — a trend call can't be confirmed without it, so leverage
          stays off until Schwab prices are flowing.
        </div>
      )}

      {regime.signals.length > 0 && (
        <div className="tbl-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Signal</th>
                <th className="num">Reading</th>
                <th className="num">Score</th>
                <th style={{ width: 140 }}>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {regime.signals.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td className="num">{s.reading}</td>
                  <td className="num">
                    <span className={toneFor(s.score)}>
                      {s.score > 0 ? '+' : ''}
                      {s.score}
                    </span>
                  </td>
                  <td>
                    <ScoreBar score={s.score} />
                  </td>
                </tr>
              ))}
              {regime.missing.map((label) => (
                <tr key={label}>
                  <td style={{ color: 'var(--muted)' }}>{label}</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>
                    no data
                  </td>
                  <td className="num" style={{ color: 'var(--muted)' }}>
                    —
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
