/**
 * The hard boundary, enforced by machine rather than by memory.
 *
 * Tradeit never trades. Schwab's API can place orders, and the individual
 * Trader API gives our credentials that power whether we want it or not — there
 * is no read-only scope to fall back on (docs/PLAN.md §0, CLAUDE.md). The only
 * thing standing between the system and an order is that no code ever calls an
 * order endpoint. This test makes that a build-breaking invariant: if anyone
 * ever adds an order-placement path or call, the suite goes red and it cannot
 * ship.
 *
 * If this test fails, do not "fix" it by loosening the patterns. The failure is
 * the point — something added an execution path that must not exist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** Source trees that ship real code. */
const SCAN_DIRS = [
  join(repoRoot, 'backend', 'src'),
  join(repoRoot, 'frontend', 'src'),
  join(repoRoot, 'packages'),
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage']);

/**
 * Signals of order execution. Each is specific enough not to match prose that
 * merely *mentions* orders — the Schwab order endpoint always sits under
 * `trader/v1/accounts/.../orders`, and the call names are camelCase identifiers.
 */
const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Schwab order endpoint', pattern: /trader\/v1\/accounts[^\n'"`]*\/orders/i },
  { label: 'order mutation call', pattern: /\b(place|cancel|replace|submit)Order\b/ },
];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // a tree that isn't present in this checkout is fine
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) files.push(...sourceFiles(full));
      continue;
    }
    // Skip test files — including this one, whose patterns would self-trip.
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry))) files.push(full);
  }
  return files;
}

describe('the hard boundary: Tradeit never places an order', () => {
  it('has no order-execution path anywhere in the shipping code', () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(dir)) {
        const text = readFileSync(file, 'utf8');
        for (const { label, pattern } of FORBIDDEN) {
          if (pattern.test(text)) {
            violations.push(`${relative(repoRoot, file)} — ${label} (/${pattern.source}/)`);
          }
        }
      }
    }

    expect(
      violations,
      `Order-execution code found. Tradeit must never place an order:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the tripwire actually has teeth — it catches real execution code', () => {
    // A guard that matches nothing passes forever while protecting nothing.
    // These are the shapes it must catch, so the check above is trustworthy.
    const wouldExecute = [
      "await fetch(`${BASE}/trader/v1/accounts/${hash}/orders`, { method: 'POST' })",
      'export async function placeOrder(order: Order) {}',
      'schwab.cancelOrder(accountHash, orderId)',
      'client.replaceOrder(acct, id, payload)',
    ];
    for (const snippet of wouldExecute) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(snippet)),
        `tripwire missed: ${snippet}`,
      ).toBe(true);
    }

    // ...and it must NOT fire on prose that merely mentions orders, or on the
    // read-only accounts endpoint we do use.
    const benign = [
      'Pete places the orders himself.',
      'this file may never POST an order',
      'GET /trader/v1/accounts?fields=positions',
    ];
    for (const snippet of benign) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(snippet)),
        `tripwire false-positive: ${snippet}`,
      ).toBe(false);
    }
  });
});
