/**
 * The research letters the Gmail collector ingests (docs/PLAN.md §3).
 *
 * A dedicated Gmail inbox is subscribed to each of these. The collector pulls
 * that inbox, and this registry decides two things per message: whether we
 * ingest it at all, and — if we do — which source it is attributed to. A
 * message whose sender matches nothing here is dropped, so the inbox getting a
 * stray email never turns into an untracked observation.
 *
 * Adding a letter is a one-line change here — the collector iterates this list
 * to build its Gmail query and to attribute every message it pulls.
 *
 * `match` is the one knob to adjust once Pete confirms the real sending
 * addresses: each entry is a lower-cased substring tested against the message's
 * From address. The first source whose list contains a match wins.
 */

/** Which pipeline stage a letter feeds — see docs/PLAN.md §5. */
export type NewsletterStage =
  | 'REGIME' // Stage 0 — macro and regime
  | 'INTERNALS' // Stage 0/1 — market internals and positioning
  | 'CATALYSTS' // Stage 1 — earnings and catalysts
  | 'FACTOR'; // shapes the screens, not the weekly picks

export interface NewsletterSourceDef {
  /** Stable slug. Goes in the observation payload as `sourceKey` — never changes. */
  readonly key: string;
  readonly name: string;
  readonly author: string;
  readonly stage: NewsletterStage;
  /** 1 = the free starting set, 3 = paid alert services (docs/PLAN.md §3). */
  readonly tier: 1 | 2 | 3;
  /**
   * Lower-cased substrings tested against the From address. Domain-level where
   * the letter sends from its own domain; the publication token where it sends
   * through Substack (e.g. `topdowncharts@substack.com`).
   */
  readonly match: readonly string[];
}

export const NEWSLETTER_SOURCES: readonly NewsletterSourceDef[] = [
  // Macro and regime — feeds Stage 0
  {
    key: 'apollo-daily-spark',
    name: 'Apollo — Daily Spark',
    author: 'Torsten Slok',
    stage: 'REGIME',
    tier: 1,
    match: ['apolloacademy.com', 'apollo.com'],
  },
  {
    key: 'verdad-weekly',
    name: 'Verdad Weekly Research',
    author: 'Dan Rasmussen',
    stage: 'REGIME',
    tier: 1,
    match: ['verdadcap.com'],
  },
  {
    key: 'schwab-sonders-jones',
    name: 'Schwab Market Commentary',
    author: 'Liz Ann Sonders & Kathy Jones',
    stage: 'REGIME',
    tier: 1,
    match: ['schwab.com'],
  },
  // Calculated Risk (Bill McBride) removed 2026-08-17 — the blog ended Jan 2026.
  {
    key: 'topdown-charts',
    name: 'Topdown Charts',
    author: 'Callum Thomas',
    stage: 'INTERNALS',
    tier: 1,
    match: ['topdowncharts'],
  },

  // Catalysts and earnings — feeds Stage 1
  {
    key: 'the-transcript',
    name: 'The Transcript',
    author: 'The Transcript',
    stage: 'CATALYSTS',
    tier: 1,
    match: ['thetranscript'],
  },
  {
    key: 'earnings-whispers',
    name: 'Earnings Whispers',
    author: 'Earnings Whispers',
    stage: 'CATALYSTS',
    tier: 1,
    match: ['earningswhispers.com'],
  },
] as const;

/** Every distinct From-match token across the registry — the Gmail query is built from these. */
export const NEWSLETTER_FROM_TOKENS: readonly string[] = Array.from(
  new Set(NEWSLETTER_SOURCES.flatMap((s) => s.match)),
);

/**
 * The source a From address belongs to, or `undefined` if it matches nothing
 * we ingest. Matching is case-insensitive substring: the first source with a
 * token contained in `fromAddress` wins.
 */
export function newsletterSourceForFrom(fromAddress: string): NewsletterSourceDef | undefined {
  const haystack = fromAddress.toLowerCase();
  return NEWSLETTER_SOURCES.find((s) => s.match.some((token) => haystack.includes(token)));
}
