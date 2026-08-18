import { describe, expect, it } from 'vitest';
import {
  buildDossier,
  observationToEvidence,
  summariseObservation,
  type ObservationRow,
} from '../services/dossier.parse.js';
import type { Candidate, DossierRegime, Indicators } from '@tradeit/shared';

function row(kind: ObservationRow['kind'], payload: unknown, over: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 'obs-1',
    source: 'NEWSLETTER',
    kind,
    scope: 'MARKET',
    observedAt: new Date('2026-08-15T00:00:00Z'),
    payload,
    url: null,
    ...over,
  };
}

describe('summariseObservation', () => {
  it('summarises a newsletter/transcript item as source: title', () => {
    expect(summariseObservation(row('LETTER_ITEM', { sourceName: 'The Diff', title: 'On rates' }))).toBe(
      'The Diff: On rates',
    );
  });
  it('summarises an econ release with value and units', () => {
    expect(
      summariseObservation(row('ECON_RELEASE', { title: '10Y Treasury', value: 4.2, units: '%' }, { source: 'FRED' })),
    ).toBe('10Y Treasury: 4.2 %');
  });
  it('summarises a VIX term-structure sentiment reading', () => {
    expect(
      summariseObservation(row('SENTIMENT_READING', { signal: 'CONTANGO', ratio: '0.77' }, { source: 'DERIVED' })),
    ).toBe('VIX term structure CONTANGO (ratio 0.77)');
  });
  it('summarises an earnings event', () => {
    expect(
      summariseObservation(row('EARNINGS_EVENT', { symbol: 'AAPL', date: '2026-08-20' }, { source: 'FINNHUB', scope: 'AAPL' })),
    ).toBe('AAPL earnings 2026-08-20');
  });
  it('is defensive against a missing payload', () => {
    expect(summariseObservation(row('LETTER_ITEM', null))).toBe('Newsletter');
  });
});

describe('observationToEvidence', () => {
  it('carries the observation id and an ISO observedAt', () => {
    const line = observationToEvidence(row('ECON_RELEASE', { title: 'CPI', value: 3.1, units: 'index' }, { id: 'obs-9', source: 'FRED', url: 'https://x' }));
    expect(line).toMatchObject({ observationId: 'obs-9', source: 'FRED', kind: 'ECON_RELEASE', url: 'https://x' });
    expect(line.observedAt).toBe('2026-08-15T00:00:00.000Z');
  });
});

describe('buildDossier', () => {
  it('assembles the candidate, price, regime, and cited context', () => {
    const candidate = { symbol: 'SPY', exposure: 'SP500', direction: 'BULLISH', conviction: 3, screens: [], asOf: '2026-08-17' } as Candidate;
    const price = { asOf: '2026-08-17', close: 500 } as Indicators;
    const regime: DossierRegime = { regime: 'RISK_ON_TREND', leverageAllowed: true, riskBudget: 0.06, asOf: '2026-08-17' };
    const context = [observationToEvidence(row('LETTER_ITEM', { sourceName: 'X', title: 'Y' }))];
    const dossier = buildDossier(candidate, price, regime, context, '2026-08-17');
    expect(dossier.candidate.symbol).toBe('SPY');
    expect(dossier.context).toHaveLength(1);
    expect(dossier.context[0]?.observationId).toBe('obs-1');
  });
});
