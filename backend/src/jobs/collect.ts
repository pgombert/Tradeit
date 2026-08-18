/**
 * Collector entrypoint. Runs as a Cloud Run Job on a Cloud Scheduler trigger,
 * separate from the API container so a collector crash can't take the app down.
 *
 *   npm run collect            # all collectors
 *   npm run collect -- fred    # one of them
 */
import { collectDerived } from '../collectors/derived.collector.js';
import { collectEarnings } from '../collectors/earnings.collector.js';
import { collectFred } from '../collectors/fred.collector.js';
import { collectGmail } from '../collectors/gmail.collector.js';
import { collectSchwabPrices } from '../collectors/schwab.prices.collector.js';
import { collectWeb } from '../collectors/web.collector.js';
import { generateBrief } from '../services/brief-generate.service.js';
import { prisma } from '../lib/prisma.js';

// Order matters for a full run: `derived` reads what `fred` just wrote. `prices`
// runs last and is independent — until Schwab is connected it skips gracefully,
// so it never blocks the collectors ahead of it.
const COLLECTORS: Record<string, () => Promise<unknown>> = {
  fred: collectFred,
  earnings: collectEarnings,
  gmail: collectGmail,
  web: collectWeb,
  derived: collectDerived,
  prices: collectSchwabPrices,
  // `brief` is the weekly pipeline (Stages 1-5, AI included). It reads what the
  // collectors wrote, is slow and paid, and is EXCLUDED from the default run —
  // trigger it explicitly (`collect -- brief`) or on its own weekly schedule.
  brief: generateBrief,
};

/** The default full run — every collector, but not the paid `brief` step. */
const DEFAULT_STEPS = Object.keys(COLLECTORS).filter((n) => n !== 'brief');

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = requested.length > 0 ? requested : DEFAULT_STEPS;

  const unknown = names.filter((n) => !(n in COLLECTORS));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown collector(s): ${unknown.join(', ')}. Available: ${Object.keys(COLLECTORS).join(', ')}`,
    );
  }

  for (const name of names) {
    const collector = COLLECTORS[name];
    if (!collector) continue;

    console.log(`[collect] running ${name}`);
    await collector();
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('[collect] done');
  })
  .catch(async (error: unknown) => {
    console.error('[collect] failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
