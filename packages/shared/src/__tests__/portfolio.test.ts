import { describe, expect, it } from 'vitest';
import { buildPortfolio, type PositionInput, type PortfolioConfig } from '../engine/portfolio.js';
import { buildRiskLimits, type MarketRegime } from '../types/risk.js';
import type { Candidate, DossierRegime } from '../types/candidate.js';

const LIMITS = buildRiskLimits(100_000, 30_000);
const regimeOf = (regime: MarketRegime): DossierRegime => ({
  regime,
  leverageAllowed: regime === 'RISK_ON_TREND',
  riskBudget: 0.06,
  asOf: '2026-08-17',
});

function candidate(symbol: string, conviction = 3): Candidate {
  return { symbol, exposure: symbol, direction: 'BULLISH', conviction: conviction as Candidate['conviction'], screens: [], asOf: '2026-08-17' };
}

function input(symbol: string, strength: number, over: Partial<PositionInput> = {}): PositionInput {
  return {
    candidate: candidate(symbol),
    entry: 100,
    atr: 3,
    vehicle: { symbol, leverageFactor: 1, isInverse: false, price: 100 },
    strength,
    earningsWithinHold: false,
    ...over,
  };
}

function cfg(over: Partial<PortfolioConfig> = {}): PortfolioConfig {
  return { capital: 100_000, drawdown: 0, regime: regimeOf('RISK_ON_TREND'), limits: LIMITS, asOf: '2026-08-17', ...over };
}

describe('buildPortfolio — momentum concentration', () => {
  it('deploys ~the whole book in Risk-On and gives each position a stop + trail rule', () => {
    const pf = buildPortfolio([input('AAA', 4), input('BBB', 3), input('CCC', 2)], cfg());
    expect(pf.deployFraction).toBe(1);
    // deployed close to the full book (share rounding leaves a little cash)
    expect(pf.capitalDeployed).toBeGreaterThan(95_000);
    expect(pf.capitalDeployed).toBeLessThanOrEqual(100_000);
    for (const p of pf.positions) {
      expect(p.stop).toBeLessThan(p.entry); // long stop below entry
      expect(p.trailRule).toContain('20-day');
    }
  });

  it('concentrates on the strongest name', () => {
    const pf = buildPortfolio([input('STRONG', 5), input('WEAK', 2)], cfg());
    const strong = pf.positions.find((p) => p.symbol === 'STRONG')!;
    const weak = pf.positions.find((p) => p.symbol === 'WEAK')!;
    // strength^2.5 → 5^2.5 ≈ 55.9 vs 2^2.5 ≈ 5.7 → strong gets ~90% of the book
    expect(strong.weight).toBeGreaterThan(weak.weight * 5);
  });

  it('can put the full book in a single standout', () => {
    const pf = buildPortfolio([input('ONLY', 5)], cfg());
    expect(pf.positions).toHaveLength(1);
    expect(pf.positions[0]!.weight).toBeGreaterThan(0.95);
    expect(pf.notes.some((n) => n.includes('Full concentration'))).toBe(true);
  });

  it('dodges earnings — a name reporting inside the hold is watch-listed, not sized', () => {
    const pf = buildPortfolio([input('RPTS', 5, { earningsWithinHold: true }), input('SAFE', 3)], cfg());
    expect(pf.positions.map((p) => p.symbol)).toEqual(['SAFE']);
    expect(pf.watchlist.map((w) => w.symbol)).toEqual(['RPTS']);
    expect(pf.watchlist[0]!.reason).toContain('earnings');
  });

  it('tapers deployment by regime and halts in crisis', () => {
    expect(buildPortfolio([input('X', 4)], cfg({ regime: regimeOf('CHOP') })).deployFraction).toBe(0.5);
    const crisis = buildPortfolio([input('X', 4)], cfg({ regime: regimeOf('CRISIS') }));
    expect(crisis.deployFraction).toBe(0);
    expect(crisis.positions).toEqual([]);
  });

  it('halves deployment at the first breaker and opens nothing at the pause breaker', () => {
    expect(buildPortfolio([input('X', 4)], cfg({ drawdown: 12_000 })).deployFraction).toBe(0.5);
    const paused = buildPortfolio([input('X', 4)], cfg({ drawdown: 21_000 }));
    expect(paused.breaker).toBe('PAUSE_AND_REVIEW');
    expect(paused.positions).toEqual([]);
  });

  it('caps the book at the position limit', () => {
    const inputs = Array.from({ length: 12 }, (_, i) => input(`S${i}`, 3));
    expect(buildPortfolio(inputs, cfg()).positions.length).toBeLessThanOrEqual(5);
  });
});
