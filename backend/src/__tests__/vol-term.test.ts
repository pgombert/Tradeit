import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { classifyVolTerm } from '../collectors/vol-term.js';

const D = (s: string) => new Prisma.Decimal(s);

describe('classifyVolTerm', () => {
  it("reads today's calm tape as deep contango, risk-on +2", () => {
    // 2026-08-13: VIX 14.63 vs 3-month 18.61 → ratio 0.7861. Longer-dated vol
    // well above near-dated is the classic calm-market shape.
    const reading = classifyVolTerm(D('14.63'), D('18.61'));
    expect(reading).toMatchObject({ signal: 'CONTANGO', score: 2, ratio: '0.7861' });
  });

  it('scores mild contango +1', () => {
    // 19 / 20 = 0.95 — contango, but shallow.
    const reading = classifyVolTerm(D('19'), D('20'));
    expect(reading).toMatchObject({ signal: 'CONTANGO', score: 1 });
  });

  it('scores a flat curve 0', () => {
    // front ≈ back is a transition, neither risk-on nor risk-off.
    const reading = classifyVolTerm(D('20'), D('20'));
    expect(reading).toMatchObject({ signal: 'FLAT', score: 0 });
  });

  it('scores shallow backwardation -1', () => {
    // 21 / 20.5 = 1.0244 — near-term fear just above longer-term.
    const reading = classifyVolTerm(D('21'), D('20.5'));
    expect(reading).toMatchObject({ signal: 'BACKWARDATION', score: -1 });
  });

  it('scores steep backwardation as acute stress -2', () => {
    // 28 / 24 = 1.1667 — a panic-shaped curve.
    const reading = classifyVolTerm(D('28'), D('24'));
    expect(reading).toMatchObject({ signal: 'BACKWARDATION', score: -2 });
  });

  it('keeps the ratio exact rather than rounding through a float', () => {
    const reading = classifyVolTerm(D('15.00'), D('20.00'));
    expect(reading?.ratio).toBe('0.75');
  });

  it('refuses to form a ratio against a non-positive back month', () => {
    // A bad data point must not fabricate a signal the regime call would trust.
    expect(classifyVolTerm(D('20'), D('0'))).toBeNull();
    expect(classifyVolTerm(D('20'), D('-1'))).toBeNull();
  });
});
