/**
 * Pure helpers for news-driven discovery. The AI reads the recent research feed
 * (newsletters, podcast transcripts, web articles) and names the tickers being
 * discussed with real bullish momentum or a near-term catalyst. This builds the
 * prompt and validates what comes back — no network, so it's testable.
 *
 * As with every AI output, nothing is trusted raw: a surfaced ticker only counts
 * once it resolves to a security we hold and clears the liquidity gate (done in
 * the service). Here we just enforce shape and cite the source it came from.
 */

/** One research item shown to the model, tagged so citations map back. */
export interface ResearchItem {
  id: string;
  source: string;
  title: string;
  text: string;
}

export interface DiscoveredTicker {
  symbol: string;
  reason: string;
  /** The observation id the mention came from — must be a real one. */
  evidenceId: string;
  /** The human-readable source it came from (newsletter/podcast name). Filled by
   * the service from the cited item; the pure validator leaves it undefined. */
  source?: string;
  confidence: number; // 1..5
}

export interface PromptPair {
  system: string;
  user: string;
}

/** Safety cap per item in the prompt; the service already budgets item text, so
 * this only guards against an unbounded item slipping through. Large enough to
 * carry a transcript's substance, not just its intro. */
const PER_ITEM_CHARS = 40_000;

export function buildDiscoveryPrompt(items: ResearchItem[]): PromptPair {
  const body = items
    .map((it) => `[${it.id}] (${it.source}) ${it.title}\n${it.text.slice(0, PER_ITEM_CHARS)}`)
    .join('\n\n---\n\n');
  return {
    system:
      'You surface trade ideas from research. Read the items below and name the individual US-listed ' +
      'STOCKS (tickers) being discussed with genuine bullish momentum, a specific near-term catalyst, or ' +
      'clearly positive conviction. Ignore names mentioned only in passing, bearishly, or as macro/context. ' +
      'Do NOT invent tickers. For each, cite the [id] of the item it came from.\n' +
      'Return ONLY a JSON object, no prose: { "tickers": [ ... ] }, where each element has exactly ' +
      'symbol (the ticker, uppercase), reason (one line on why), evidenceId (the [id] string), ' +
      'confidence (integer 1-5). Use an empty array if nothing qualifies.',
    user: `RESEARCH ITEMS:\n\n${body}`,
  };
}

function isSymbol(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Z]{1,5}$/.test(s.trim().toUpperCase());
}

/**
 * Validate the model's array. Keeps only well-formed entries citing a real
 * evidence id, with confidence in range; symbols are upper-cased and de-duped
 * (highest confidence wins). Liquidity/resolution is enforced later by the service.
 */
export function validateDiscovered(raw: unknown, validEvidenceIds: Set<string>): DiscoveredTicker[] {
  // Accept either a bare array or the { tickers: [...] } wrapper.
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).tickers)
      ? ((raw as Record<string, unknown>).tickers as unknown[])
      : [];
  const bySymbol = new Map<string, DiscoveredTicker>();

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!isSymbol(e.symbol)) continue;
    const symbol = (e.symbol as string).trim().toUpperCase();

    const confidence = e.confidence;
    if (typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
      continue;
    }
    const evidenceId = typeof e.evidenceId === 'string' ? e.evidenceId : '';
    if (!validEvidenceIds.has(evidenceId)) continue; // cited a source we don't hold → drop
    const reason = typeof e.reason === 'string' ? e.reason.trim() : '';
    if (!reason) continue;

    const existing = bySymbol.get(symbol);
    if (!existing || confidence > existing.confidence) {
      bySymbol.set(symbol, { symbol, reason, evidenceId, confidence });
    }
  }
  return [...bySymbol.values()];
}
