import { describe, expect, it } from 'vitest';
import { buildDiscoveryPrompt, validateDiscovered, type ResearchItem } from '../services/discovery.parse.js';

const VALID = new Set(['obs-1', 'obs-2']);

describe('validateDiscovered', () => {
  it('accepts well-formed tickers citing a real source (array or wrapped)', () => {
    const raw = { tickers: [{ symbol: 'nvda', reason: 'AI demand', evidenceId: 'obs-1', confidence: 4 }] };
    const out = validateDiscovered(raw, VALID);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ symbol: 'NVDA', confidence: 4, evidenceId: 'obs-1' });
    // bare array works too
    expect(validateDiscovered(raw.tickers, VALID)).toHaveLength(1);
  });

  it('drops entries citing an evidence id we do not hold', () => {
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: 'obs-9', confidence: 3 }], VALID)).toEqual([]);
  });

  it('rejects bad symbols, out-of-range confidence, and empty reasons', () => {
    expect(validateDiscovered([{ symbol: 'TOOLONGSYM', reason: 'x', evidenceId: 'obs-1', confidence: 3 }], VALID)).toEqual([]);
    expect(validateDiscovered([{ symbol: 'AAPL', reason: 'x', evidenceId: 'obs-1', confidence: 9 }], VALID)).toEqual([]);
    expect(validateDiscovered([{ symbol: 'AAPL', reason: '', evidenceId: 'obs-1', confidence: 3 }], VALID)).toEqual([]);
    expect(validateDiscovered('not json', VALID)).toEqual([]);
  });

  it('de-dupes a symbol, keeping the highest confidence', () => {
    const out = validateDiscovered(
      [
        { symbol: 'MSFT', reason: 'a', evidenceId: 'obs-1', confidence: 2 },
        { symbol: 'MSFT', reason: 'b', evidenceId: 'obs-2', confidence: 5 },
      ],
      VALID,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(5);
  });
});

describe('buildDiscoveryPrompt', () => {
  it('tags each item with its id and asks for JSON', () => {
    const items: ResearchItem[] = [{ id: 'obs-1', source: 'The Diff', title: 'On chips', text: 'NVDA is ripping'.repeat(20) }];
    const { system, user } = buildDiscoveryPrompt(items);
    expect(user).toContain('[obs-1]');
    expect(system).toContain('JSON');
  });
});
