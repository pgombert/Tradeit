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
  // Items are numbered [1]..[N]; the model cites the number, not a fragile UUID.
  const body = items
    .map((it, i) => `[${i + 1}] (${it.source}) ${it.title}\n${it.text.slice(0, PER_ITEM_CHARS)}`)
    .join('\n\n---\n\n');
  return {
    system:
      'You surface single-stock trade ideas from research — newsletters and podcast transcripts. Read the items ' +
      'and name the individual US-listed STOCKS (tickers) the writers/hosts discuss with genuine bullish interest: ' +
      'real momentum, a specific catalyst, or clear positive conviction. Ignore names mentioned only in passing, ' +
      'bearishly, or purely as macro/economic context, and ignore index ETFs. Surface every name that has a real ' +
      'bullish case in the text — a lively podcast can yield several. Do NOT invent tickers or cases not in the text.\n' +
      'For each idea, cite the item NUMBER it came from (the [N] label).\n' +
      'Return ONLY a JSON object, no prose: { "tickers": [ ... ] }, where each element has exactly ' +
      'symbol (uppercase ticker), reason (one line — quote or paraphrase the actual bullish point made), ' +
      'evidenceId (the item number as a string, e.g. "3"), confidence (integer 1-5). ' +
      'Use an empty array ONLY if the text genuinely discusses no stock bullishly.',
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
export function validateDiscovered(raw: unknown, validRefs: Set<string>): DiscoveredTicker[] {
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
    // The model cites an item number; tolerate "3", 3, or "[3]".
    const rawId = e.evidenceId;
    const evidenceId =
      typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId.replace(/[^\d]/g, '') : '';
    if (!validRefs.has(evidenceId)) continue; // cited an item we don't hold → drop
    const reason = typeof e.reason === 'string' ? e.reason.trim() : '';
    if (!reason) continue;

    const existing = bySymbol.get(symbol);
    if (!existing || confidence > existing.confidence) {
      bySymbol.set(symbol, { symbol, reason, evidenceId, confidence });
    }
  }
  return [...bySymbol.values()];
}
