/**
 * Collector entrypoint. Runs as a Cloud Run Job on a Cloud Scheduler trigger,
 * separate from the API container so a collector crash can't take the app down.
 *
 *   npm run collect            # all collectors
 *   npm run collect -- fred    # one of them
 */
import { collectFred } from '../collectors/fred.collector.js';
import { prisma } from '../lib/prisma.js';

const COLLECTORS: Record<string, () => Promise<unknown>> = {
  fred: collectFred,
};

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = requested.length > 0 ? requested : Object.keys(COLLECTORS);

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
