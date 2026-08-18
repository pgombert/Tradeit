import { describe, expect, it } from 'vitest';
import {
  buildAnalystPrompt,
  serialiseDossier,
  validateAnalystVerdict,
  validateRedTeamVerdict,
} from '../services/analyst.parse.js';
import type { Candidate, Dossier, DossierRegime, EvidenceLine, Indicators } from '@tradeit/shared';

const REGIME: DossierRegime = { regime: 'RISK_ON_TREND', leverageAllowed: true, riskBudget: 0.06, asOf: '2026-08-17' };

function dossier(contextIds: string[]): Dossier {
  const candidate: Candidate = { symbol: 'XLK', exposure: 'TECH', direction: 'BULLISH', conviction: 3, screens: [], asOf: '2026-08-17' };
  const price = { asOf: '2026-08-17', close: 200, return3m: 0.08, rsi14: 55, above200dma: true } as Indicators;
  const context: EvidenceLine[] = contextIds.map((id) => ({
    observationId: id,
    source: 'NEWSLETTER',
    kind: 'LETTER_ITEM',
    scope: 'MARKET',
    observedAt: '2026-08-15T00:00:00.000Z',
    summary: `note ${id}`,
    url: null,
  }));
  return { candidate, price, regime: REGIME, context, asOf: '2026-08-17' };
}

const GOOD = {
  thesis: 'Tech leadership intact',
  direction: 'BULLISH',
  conviction: 4,
  catalyst: 'Earnings season momentum',
  whatWouldProveWrong: 'A break below the 200-day',
  evidenceIds: ['obs-1'],
};

describe('validateAnalystVerdict', () => {
  it('accepts a well-formed verdict and forces the canonical symbol', () => {
    const v = validateAnalystVerdict({ ...GOOD, symbol: 'HACKED' }, dossier(['obs-1', 'obs-2']));
    expect(v).not.toBeNull();
    expect(v?.symbol).toBe('XLK'); // forced to the candidate, not the model's
    expect(v?.conviction).toBe(4);
    expect(v?.evidenceIds).toEqual(['obs-1']);
  });

  it('discards the whole verdict when it cites an evidence id we do not hold', () => {
    // obs-9 isn't in the dossier — hallucinated citation → discard whole.
    expect(validateAnalystVerdict({ ...GOOD, evidenceIds: ['obs-1', 'obs-9'] }, dossier(['obs-1']))).toBeNull();
  });

  it('allows an empty evidence list (a purely price-driven thesis)', () => {
    expect(validateAnalystVerdict({ ...GOOD, evidenceIds: [] }, dossier(['obs-1']))).not.toBeNull();
  });

  it('rejects a bad direction, out-of-range conviction, or missing fields', () => {
    const d = dossier(['obs-1']);
    expect(validateAnalystVerdict({ ...GOOD, direction: 'SIDEWAYS' }, d)).toBeNull();
    expect(validateAnalystVerdict({ ...GOOD, conviction: 7 }, d)).toBeNull();
    expect(validateAnalystVerdict({ ...GOOD, conviction: 2.5 }, d)).toBeNull();
    expect(validateAnalystVerdict({ ...GOOD, thesis: '' }, d)).toBeNull();
    expect(validateAnalystVerdict(null, d)).toBeNull();
  });
});

describe('validateRedTeamVerdict', () => {
  it('keeps a survivor with no cause of death', () => {
    const v = validateRedTeamVerdict({ survives: true, bearCase: 'weak bear case', whatsPriced: 'a lot', crowding: 'low', causeOfDeath: null }, 'XLK');
    expect(v.survives).toBe(true);
    expect(v.causeOfDeath).toBeNull();
  });
  it('kills a thesis and keeps the cause', () => {
    const v = validateRedTeamVerdict({ survives: false, bearCase: 'strong', whatsPriced: 'priced', crowding: 'high', causeOfDeath: 'Overcrowded' }, 'XLK');
    expect(v.survives).toBe(false);
    expect(v.causeOfDeath).toBe('Overcrowded');
  });
  it('fails safe — an unreadable attack kills the thesis', () => {
    expect(validateRedTeamVerdict(null, 'XLK').survives).toBe(false);
    expect(validateRedTeamVerdict({ survives: 'maybe' }, 'XLK').survives).toBe(false);
  });
});

describe('serialiseDossier / buildAnalystPrompt', () => {
  it('renders the candidate, price, regime, and cited evidence ids', () => {
    const text = serialiseDossier(dossier(['obs-1', 'obs-2']));
    expect(text).toContain('CANDIDATE: XLK');
    expect(text).toContain('[obs-1]');
    expect(text).toContain('RISK_ON_TREND');
    const prompt = buildAnalystPrompt(dossier(['obs-1']));
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('XLK');
  });
});
