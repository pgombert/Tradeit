/**
 * Pure Stage 2 helpers: turn a stored observation into a citable evidence line,
 * and assemble a dossier. No Prisma, no clock — the service loads observations
 * and passes rows here, so the summarising can be tested against fixtures.
 *
 * Every dossier line carries its observation id (CLAUDE.md rule 1): the packet
 * Stage 3 reads can always be traced back to a real row.
 */
import type {
  Candidate,
  Dossier,
  DossierRegime,
  EvidenceLine,
  Indicators,
  ObservationKind,
  ObservationSource,
} from '@tradeit/shared';

/** The observation fields Stage 2 reads — a subset of the Prisma row. */
export interface ObservationRow {
  id: string;
  source: ObservationSource;
  kind: ObservationKind;
  scope: string;
  observedAt: Date;
  payload: unknown;
  url: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** A short human summary of an observation, by kind, defensively parsed. */
export function summariseObservation(o: ObservationRow): string {
  const p = (o.payload ?? {}) as Record<string, unknown>;
  switch (o.kind) {
    case 'LETTER_ITEM': {
      const who = str(p.sourceName) ?? str(p.author) ?? str(p.from) ?? 'Newsletter';
      const what = str(p.title) ?? str(p.subject) ?? str(p.excerpt) ?? '';
      return what ? `${who}: ${what}` : who;
    }
    case 'ECON_RELEASE': {
      const title = str(p.title) ?? str(p.seriesId) ?? 'Economic release';
      const value = p.value;
      const units = str(p.units) ?? '';
      return value === undefined || value === null ? title : `${title}: ${String(value)} ${units}`.trim();
    }
    case 'SENTIMENT_READING': {
      const signal = str(p.signal) ?? 'reading';
      const ratio = str(p.ratio);
      return ratio ? `VIX term structure ${signal} (ratio ${ratio})` : `VIX term structure ${signal}`;
    }
    case 'EARNINGS_EVENT': {
      const sym = str(p.symbol) ?? o.scope;
      const date = str(p.date) ?? '';
      return `${sym} earnings ${date}`.trim();
    }
    default:
      return `${o.kind} (${o.source})`;
  }
}

export function observationToEvidence(o: ObservationRow): EvidenceLine {
  return {
    observationId: o.id,
    source: o.source,
    kind: o.kind,
    scope: o.scope,
    observedAt: o.observedAt.toISOString(),
    summary: summariseObservation(o),
    url: o.url,
  };
}

/** Assemble one candidate's dossier from its already-computed indicators, the
 * regime, and the market-context evidence lines that bear on it. */
export function buildDossier(
  candidate: Candidate,
  price: Indicators,
  regime: DossierRegime,
  context: EvidenceLine[],
  asOf: string,
): Dossier {
  return { candidate, price, regime, context, asOf };
}
