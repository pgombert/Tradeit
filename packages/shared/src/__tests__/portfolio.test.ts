import { describe, expect, it } from 'vitest';
import { buildPortfolio, type PositionInput, type PortfolioConfig } from '../engine/portfolio.js';
import { buildRiskLimits } from '../types/risk.js';
import type { Candidate, DossierRegime } from '../types/candidate.js';

const LIMITS = buildRiskLimits(100_000, 30_000);
const RISK_ON: DossierRegime = { regime: 'RISK_ON_TREND', leverageAllowed: true, riskBudget: 0.06, asOf: '2026-08-17' };

function candidate(symbol: string, direction: 'BULLISH' | 'BEARISH' = 'BULLISH', conviction = 3): Candidate {
  return { symbol, exposure: symbol, direction, conviction: conviction as Candidate['conviction'], screens: [], asOf: '2026-08-17' };
}

function cfg(over: Partial<PortfolioConfig> = {}): PortfolioConfig {
  return { capital: 100_000, drawdown: 0, regime: RISK_ON, limits: LIMITS, asOf: '2026-08-17', ...over };
}

describe('buildPortfolio', () => {
  it('sizes a bullish position with a tight stop, 3:1 target, and an exit date', () => {
    const inputs: PositionInput[] = [
      { candidate: candidate('AAPL'), entry: 100, atr: 2, vehicle: { symbol: 'AAPL', leverageFactor: 1, isInverse: false, price: 100 } },
    ];
    const pf = buildPortfolio(inputs, cfg());
    expect(pf.positions).toHaveLength(1);
    const p = pf.positions[0]!;
    // stopFraction = 2*2/100 = 0.04 → stop 96; targetFraction = 6*2/100 = 0.12 → target 112 (3:1)
    expect(p.stop).toBeCloseTo(96, 6);
    expect(p.target).toBeCloseTo(112, 6);
    expect(p.exitDate).toBe('2026-08-27'); // asOf + 10 days
    // per-position cap (20% of 100k = 20k) binds → 200 shares at $100
    expect(p.positionValue).toBeCloseTo(20_000, 6);
    expect(p.shares).toBe(200);
    expect(p.bookFraction).toBeCloseTo(0.2, 6);
  });

  it('keeps the leveraged sleeve within the 20%-of-book cap', () => {
    const inputs: PositionInput[] = Array.from({ length: 3 }, (_, i) => ({
      candidate: candidate(`E${i}`, 'BULLISH', 5),
      entry: 100,
      atr: 2,
      vehicle: { symbol: `LEV${i}`, leverageFactor: 3, isInverse: false, price: 50 },
    }));
    const pf = buildPortfolio(inputs, cfg());
    // total leveraged notional must not exceed 20% of 100k = 20k
    const leveraged = pf.positions.reduce((s, p) => s + p.positionValue, 0);
    expect(leveraged).toBeLessThanOrEqual(20_000 + 1);
    expect(pf.leveragedFraction).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('halves sizing when drawdown breaches the first breaker', () => {
    const full = buildPortfolio(
      [{ candidate: candidate('X'), entry: 100, atr: 5, vehicle: { symbol: 'X', leverageFactor: 1, isInverse: false, price: 100 } }],
      cfg(),
    );
    const halved = buildPortfolio(
      [{ candidate: candidate('X'), entry: 100, atr: 5, vehicle: { symbol: 'X', leverageFactor: 1, isInverse: false, price: 100 } }],
      cfg({ drawdown: 12_000 }), // > halveSizeAt (10k)
    );
    expect(halved.breaker).toBe('HALVE_SIZE');
    expect(halved.weeklyRiskBudget).toBeCloseTo(full.weeklyRiskBudget / 2, 6);
  });

  it('opens no positions at the pause breaker or in a crisis', () => {
    const paused = buildPortfolio(
      [{ candidate: candidate('X'), entry: 100, atr: 5, vehicle: { symbol: 'X', leverageFactor: 1, isInverse: false, price: 100 } }],
      cfg({ drawdown: 21_000 }), // > pauseAt (20k)
    );
    expect(paused.breaker).toBe('PAUSE_AND_REVIEW');
    expect(paused.positions).toEqual([]);

    const crisis = buildPortfolio(
      [{ candidate: candidate('X'), entry: 100, atr: 5, vehicle: { symbol: 'X', leverageFactor: 1, isInverse: false, price: 100 } }],
      cfg({ regime: { ...RISK_ON, regime: 'CRISIS' } }),
    );
    expect(crisis.positions).toEqual([]);
  });

  it('never deploys more than settled capital (scales to fit)', () => {
    // Small ATR → each position wants the per-position cap; 8 of them would sum
    // to 160% of book, so the settled-cash constraint scales them down.
    const inputs: PositionInput[] = Array.from({ length: 8 }, (_, i) => ({
      candidate: candidate(`S${i}`),
      entry: 100,
      atr: 1,
      vehicle: { symbol: `S${i}`, leverageFactor: 1, isInverse: false, price: 100 },
    }));
    const pf = buildPortfolio(inputs, cfg());
    expect(pf.capitalDeployed).toBeLessThanOrEqual(100_000 + 1);
    expect(pf.notes.some((n) => n.includes('settled capital'))).toBe(true);
  });

  it('spreads the weekly risk budget across at most the position cap', () => {
    const inputs: PositionInput[] = Array.from({ length: 20 }, (_, i) => ({
      candidate: candidate(`S${i}`),
      entry: 100,
      atr: 5,
      vehicle: { symbol: `S${i}`, leverageFactor: 1, isInverse: false, price: 100 },
    }));
    const pf = buildPortfolio(inputs, cfg());
    expect(pf.positions.length).toBeLessThanOrEqual(8);
  });
});
