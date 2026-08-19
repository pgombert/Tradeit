import { describe, expect, it } from 'vitest';
import { buildDiscoveryPrompt, validateDiscovered, type ResearchItem } from '../services/discovery.parse.js';

// Items are cited by their 1-based number, not a UUID.
const VALID = new Set(['1', '2']);

describe('validateDiscovered', () => {
  it('accepts well-formed tickers citing a real item number (array or wrapped)', () => {
    const raw = { tickers: [{ symbol: 'nvda', reason: 'AI demand', evidenceId: '1', confidence: 4 }] };
    const out = validateDiscovered(raw, VALID);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ symbol: 'NVDA', confidence: 4, evidenceId: '1' });
    // bare array works too
    expect(validateDiscovered(raw.tickers, VALID)).toHaveLength(1);
  });

  it('tolerates the number as an int or bracketed string', () => {
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: 2, confidence: 3 }], VALID)).toHaveLength(1);
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: '[2]', confidence: 3 }], VALID)).toHaveLength(1);
  });

  it('drops entries citing an item number we do not hold', () => {
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: '9', confidence: 3 }], VALID)).toEqual([]);
  });

  it('rejects bad symbols, out-of-range confidence, and empty reasons', () => {
    expect(validateDiscovered([{ symbol: 'TOOLONGSYM', reason: 'x', evidenceId: '1', confidence: 3 }], VALID)).toEqual([]);
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: '1', confidence: 9 }], VALID)).toEqual([]);
    expect(validateDiscovered([{ symbol: 'AAPL', reason: '', evidenceId: '1', confidence: 3 }], VALID)).toEqual([]);
    expect(validateDiscovered('not json', VALID)).toEqual([]);
  });

  it('de-dupes a symbol, keeping the highest confidence', () => {
    const out = validateDiscovered(
      [
        { symbol: 'MSFT', reason: 'a', evidenceId: '1', confidence: 2 },
        { symbol: 'MSFT', reason: 'b', evidenceId: '2', confidence: 5 },
      ],
      VALID,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(5);
  });
});

describe('buildDiscoveryPrompt', () => {
  it('numbers each item and asks for JSON', () => {
    const items: ResearchItem[] = [{ id: 'obs-uuid-1', source: 'The Diff', title: 'On chips', text: 'NVDA is ripping'.repeat(20) }];
    const { system, user } = buildDiscoveryPrompt(items);
    expect(user).toContain('[1]');
    expect(user).toContain('The Diff');
    expect(system).toContain('JSON');
  });
});
