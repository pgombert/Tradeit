/**
 * Web-published research the content engine ingests (docs/PLAN.md §3) — the
 * counterpart to the email `newsletter-sources.ts`. Where a letter arrives in
 * the inbox, this content lives on the open web: blogs, Substacks, firm insight
 * pages, podcast show-notes.
 *
 * Two mechanisms, chosen per source:
 *   - FEED   — the site publishes an RSS/Atom feed (blogs, Substacks, Fed
 *              research). Robust and low-maintenance: we read the feed.
 *   - SCRAPE — no feed exists (asset-manager marketing pages). We read a listing
 *              page for new-article links. Brittle by nature; expect upkeep when
 *              the firm redesigns.
 *
 * Unlike the inbox (capture-everything), the open web is unbounded, so web
 * ingestion is registry-driven: we only pull what is listed here. Adding a
 * source is a one-line entry.
 */
import type { NewsletterStage } from './newsletter-sources.js';

export type WebChannel = 'FEED' | 'SCRAPE';

export interface WebSourceDef {
  /** Stable slug — goes in the observation payload as `sourceKey`. */
  readonly key: string;
  readonly name: string;
  readonly author: string;
  readonly stage: NewsletterStage;
  readonly tier: 1 | 2 | 3;
  readonly channel: WebChannel;
  /** FEED: the RSS/Atom URL. */
  readonly feed?: string;
  /** SCRAPE: the listing page read for new-article links. */
  readonly listUrl?: string;
  /**
   * SCRAPE: only anchors whose resolved URL contains this substring are treated
   * as articles — keeps nav, footer and cross-promo links out.
   */
  readonly linkMatch?: string;
  /** Publisher homepage — reference, and a base for re-discovering a feed. */
  readonly homepage: string;
}

export const WEB_SOURCES: readonly WebSourceDef[] = [
  // --- Independent macro — RSS -------------------------------------------
  { key: 'klement-on-investing', name: 'Klement on Investing', author: 'Joachim Klement', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://klementoninvesting.substack.com/feed', homepage: 'https://klementoninvesting.substack.com' },
  { key: 'chartbook', name: 'Chartbook', author: 'Adam Tooze', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://adamtooze.substack.com/feed', homepage: 'https://adamtooze.substack.com' },
  { key: 'the-diff', name: 'The Diff', author: 'Byrne Hobart', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.thediff.co/feed', homepage: 'https://www.thediff.co' },
  { key: 'net-interest', name: 'Net Interest', author: 'Marc Rubinstein', stage: 'INTERNALS', tier: 1, channel: 'FEED', feed: 'https://www.netinterest.co/feed', homepage: 'https://www.netinterest.co' },
  { key: 'apricitas', name: 'Apricitas Economics', author: 'Joey Politano', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.apricitas.io/feed', homepage: 'https://www.apricitas.io' },
  { key: 'noahpinion', name: 'Noahpinion', author: 'Noah Smith', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.noahpinion.blog/feed', homepage: 'https://www.noahpinion.blog' },
  { key: 'fed-guy', name: 'Fed Guy', author: 'Joseph Wang', stage: 'INTERNALS', tier: 1, channel: 'FEED', feed: 'https://fedguy.com/feed/', homepage: 'https://fedguy.com' },
  { key: 'wolf-street', name: 'Wolf Street', author: 'Wolf Richter', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://wolfstreet.com/feed/', homepage: 'https://wolfstreet.com' },
  { key: 'marginal-revolution', name: 'Marginal Revolution', author: 'Tyler Cowen & Alex Tabarrok', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://marginalrevolution.com/feed', homepage: 'https://marginalrevolution.com' },
  // Calculated Risk (Bill McBride) removed 2026-08-17 — the blog ended in Jan 2026
  // ("This is the End and a New Beginning"), so the feed carries no current posts.

  // --- Quant / factor — RSS ----------------------------------------------
  { key: 'alpha-architect', name: 'Alpha Architect', author: 'Wes Gray et al.', stage: 'FACTOR', tier: 1, channel: 'FEED', feed: 'https://alphaarchitect.com/feed/', homepage: 'https://alphaarchitect.com' },
  { key: 'musings-on-markets', name: 'Musings on Markets', author: 'Aswath Damodaran', stage: 'FACTOR', tier: 1, channel: 'FEED', feed: 'https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss', homepage: 'https://aswathdamodaran.blogspot.com' },

  // --- RIA / advisor — RSS -----------------------------------------------
  { key: 'a-wealth-of-common-sense', name: 'A Wealth of Common Sense', author: 'Ben Carlson', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://awealthofcommonsense.com/feed/', homepage: 'https://awealthofcommonsense.com' },
  { key: 'the-big-picture', name: 'The Big Picture', author: 'Barry Ritholtz', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://ritholtz.com/feed/', homepage: 'https://ritholtz.com' },
  { key: 'pragmatic-capitalism', name: 'Pragmatic Capitalism', author: 'Cullen Roche', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.pragcap.com/feed/', homepage: 'https://www.pragcap.com' },

  // --- Official research blogs — RSS -------------------------------------
  { key: 'liberty-street-economics', name: 'Liberty Street Economics', author: 'NY Fed', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://libertystreeteconomics.newyorkfed.org/feed/', homepage: 'https://libertystreeteconomics.newyorkfed.org' },

  // --- Batch 2 — RSS, feed URLs validated live 2026-08-17 ----------------
  { key: 'the-overshoot', name: 'The Overshoot', author: 'Matthew Klein', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://theovershoot.co/feed', homepage: 'https://theovershoot.co' },
  { key: 'doomberg', name: 'Doomberg', author: 'Doomberg', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://newsletter.doomberg.com/feed', homepage: 'https://newsletter.doomberg.com' },
  { key: 'felder-report', name: 'The Felder Report', author: 'Jesse Felder', stage: 'INTERNALS', tier: 1, channel: 'FEED', feed: 'https://thefelderreport.com/feed/', homepage: 'https://thefelderreport.com' },
  { key: 'of-dollars-and-data', name: 'Of Dollars and Data', author: 'Nick Maggiulli', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://ofdollarsanddata.com/feed/', homepage: 'https://ofdollarsanddata.com' },
  { key: 'meb-faber', name: 'Meb Faber Research', author: 'Meb Faber · Cambria', stage: 'FACTOR', tier: 1, channel: 'FEED', feed: 'https://mebfaber.com/feed/', homepage: 'https://mebfaber.com' },
  { key: 'abnormal-returns', name: 'Abnormal Returns', author: 'Tadas Viskanta', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://abnormalreturns.com/feed/', homepage: 'https://abnormalreturns.com' },
  { key: 'bank-underground', name: 'Bank Underground', author: 'Bank of England staff', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://bankunderground.co.uk/feed/', homepage: 'https://bankunderground.co.uk' },
  { key: 'last-bear-standing', name: 'The Last Bear Standing', author: 'The Last Bear Standing', stage: 'INTERNALS', tier: 1, channel: 'FEED', feed: 'https://www.thelastbearstanding.com/feed', homepage: 'https://www.thelastbearstanding.com' },
  { key: 'concoda', name: 'Concoda', author: 'Concoda', stage: 'INTERNALS', tier: 1, channel: 'FEED', feed: 'https://concoda.substack.com/feed', homepage: 'https://concoda.substack.com' },
  { key: 'flirting-with-models', name: 'Flirting with Models', author: 'Corey Hoffstein · Newfound', stage: 'FACTOR', tier: 1, channel: 'FEED', feed: 'https://blog.thinknewfound.com/feed/', homepage: 'https://blog.thinknewfound.com' },
  { key: 'calafia-beach-pundit', name: 'Calafia Beach Pundit', author: 'Scott Grannis', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://scottgrannis.blogspot.com/feeds/posts/default?alt=rss', homepage: 'https://scottgrannis.blogspot.com' },
  { key: 'employ-america', name: 'Employ America', author: 'Employ America', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.employamerica.org/feed', homepage: 'https://www.employamerica.org' },
  { key: 'marc-to-market', name: 'Marc to Market', author: 'Marc Chandler', stage: 'REGIME', tier: 1, channel: 'FEED', feed: 'https://www.marctomarket.com/feeds/posts/default?alt=rss', homepage: 'https://www.marctomarket.com' },

  // --- Firm insight pages — SCRAPE (no feed; expect upkeep) --------------
  {
    key: 'jpm-notes-week-ahead',
    name: 'Notes on the Week Ahead',
    author: 'David Kelly · J.P. Morgan AM',
    stage: 'REGIME',
    tier: 1,
    channel: 'SCRAPE',
    listUrl:
      'https://am.jpmorgan.com/us/en/asset-management/adv/insights/market-insights/market-updates/notes-on-the-week-ahead/',
    linkMatch: '/notes-on-the-week-ahead/',
    homepage: 'https://am.jpmorgan.com',
  },
] as const;

export function webSourcesByChannel(channel: WebChannel): WebSourceDef[] {
  return WEB_SOURCES.filter((s) => s.channel === channel);
}
