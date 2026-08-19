/**
 * Stage 6 — assemble and store the weekly brief. Runs the whole chain: the
 * rules-only brief (Stages 1-2), then the AI analyst and red team (Stages 3-4)
 * on the top candidates, then sizes the *survivors* into the final portfolio
 * (Stage 5). The result is persisted so the API serves it instantly rather than
 * re-running the model on every request.
 *
 * Cost control: only the top `ANALYSIS_LIMIT` candidates go through the model.
 * The AI supplies judgement; the numbers (prices, stops, sizes) stay ours.
 */
import { Prisma } from '@prisma/client';
import type {
  AnalysedCandidate,
  Candidate,
  Conviction,
  Indicators,
  NarrativeIdea,
  StoredBrief,
} from '@tradeit/shared';
import { prisma } from '../lib/prisma.js';
import { buildBrief } from './brief.service.js';
import { discover } from './discovery.service.js';
import { analystPass, llmConfigured, redTeamPass } from './llm.js';
import { constructPortfolio } from './portfolio.service.js';

/**
 * How many top candidates run through the (paid, slower) AI stages. Widened from
 * 10 so the sharper breakout names actually get analysed rather than being
 * squeezed out below the steadiest large-caps before the model ever reads them.
 */
const ANALYSIS_LIMIT = 20;

function validAsOf(asOf: string): Date {
  const d = new Date(`${asOf}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function save(stored: StoredBrief): Promise<void> {
  await prisma.weeklyBrief.create({
    data: {
      asOf: validAsOf(stored.asOf),
      regime: stored.regime.regime,
      payload: stored as unknown as Prisma.InputJsonObject,
    },
  });
}

/**
 * Generate and store the weekly brief. If no AI key is configured it stores the
 * rules-only brief (candidates + rules portfolio) so the pipeline still runs.
 */
export async function generateBrief(): Promise<StoredBrief> {
  const brief = await buildBrief();
  const generatedAt = new Date().toISOString();
  const indicators: Map<string, Indicators> = new Map(
    brief.dossiers.map((d) => [d.candidate.symbol, d.price]),
  );

  if (!llmConfigured()) {
    const stored: StoredBrief = {
      asOf: brief.asOf,
      generatedAt,
      regime: brief.regime,
      candidates: brief.candidates,
      analysed: [],
      portfolio: brief.portfolio,
      narrativeIdeas: [],
      aiRan: false,
    };
    await save(stored);
    console.log('[brief] stored rules-only (no AI key)');
    return stored;
  }

  // Stage 1 discovery: the model reads the research feed and names tickers with
  // momentum/catalyst. A candidate that momentum AND the narrative both point to
  // gets a conviction boost and a 'narrative' screen; the rest are surfaced as
  // ideas. (Names not already in the screened universe show as ideas only for now.)
  const discovered = await discover();
  const discoveredBy = new Map(discovered.map((d) => [d.symbol, d]));
  const candidateSymbols = new Set(brief.candidates.map((c) => c.symbol));

  const candidates: Candidate[] = brief.candidates
    .map((c) => {
      const d = discoveredBy.get(c.symbol);
      if (!d) return c;
      return {
        ...c,
        conviction: Math.min(5, c.conviction + 1) as Conviction,
        screens: [
          ...c.screens,
          { screen: 'narrative', score: d.confidence / 5, direction: c.direction, rationale: d.reason, evidence: [d.evidenceId] },
        ],
      };
    })
    .sort((a, b) => b.conviction - a.conviction);

  const narrativeIdeas: NarrativeIdea[] = discovered.map((d) => ({
    symbol: d.symbol,
    reason: d.reason,
    confidence: d.confidence,
    inBook: candidateSymbols.has(d.symbol),
  }));
  if (discovered.length) console.log(`[brief] discovery surfaced ${discovered.length} names (${narrativeIdeas.filter((i) => i.inBook).length} already in the book)`);

  const dossierBySymbol = new Map(brief.dossiers.map((d) => [d.candidate.symbol, d]));
  const top = candidates.slice(0, ANALYSIS_LIMIT);

  const analysed: AnalysedCandidate[] = [];
  const survivors: Candidate[] = [];

  for (const candidate of top) {
    const dossier = dossierBySymbol.get(candidate.symbol);
    if (!dossier) continue;

    const analyst = await analystPass(dossier); // Stage 3 (validated or null)
    if (!analyst) {
      console.log(`[brief] ${candidate.symbol} — analyst verdict discarded by the gate`);
      continue;
    }
    const redTeam = await redTeamPass(analyst, dossier); // Stage 4
    const survived = redTeam.survives;
    analysed.push({ analyst, redTeam, survived });

    if (survived) {
      // Carry the AI's refined direction and conviction into sizing.
      survivors.push({ ...candidate, direction: analyst.direction, conviction: analyst.conviction });
    }
    console.log(`[brief] ${candidate.symbol} — ${survived ? 'SURVIVED' : 'killed'} (conviction ${analyst.conviction})`);
  }

  // Stage 5 on the survivors only.
  const portfolio = await constructPortfolio(survivors, indicators, brief.regime, brief.asOf);

  const stored: StoredBrief = {
    asOf: brief.asOf,
    generatedAt,
    regime: brief.regime,
    candidates,
    analysed,
    portfolio,
    narrativeIdeas,
    aiRan: true,
  };
  await save(stored);
  console.log(
    `[brief] stored — ${candidates.length} candidates, ${analysed.length} analysed, ${survivors.length} survivors, ${portfolio.positions.length} positions`,
  );
  return stored;
}

/** The most recently generated brief, or null if none has been generated yet. */
export async function getLatestBrief(): Promise<StoredBrief | null> {
  const row = await prisma.weeklyBrief.findFirst({ orderBy: { generatedAt: 'desc' } });
  return row ? (row.payload as unknown as StoredBrief) : null;
}
