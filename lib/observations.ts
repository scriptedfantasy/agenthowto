import { getDb } from '@/db';
import {
  originGroupsSql,
  discoveryGroupsSql,
  reuseTotalsSql,
  reuseChainsSql,
  reuseEventsSql,
  relationshipsTotalsSql,
  relationshipsPairsSql,
  type Observations,
  type OriginGroup,
  type DiscoveryGroup,
  type ReuseChain,
  type ReuseEvent,
} from './observations-data';

export async function observations(
  start: string,
  end: string,
): Promise<Omit<Observations, 'other_origin_entities'>> {
  const db = getDb();
  const eventArgs = [start, end, start, end];
  const [
    origins,
    discovery,
    totals,
    chains,
    relationshipTotals,
    relationshipPairs,
  ] = await db.batch([
    db.prepare(originGroupsSql).bind(start, end, end),
    db.prepare(discoveryGroupsSql).bind(start, end),
    db.prepare(reuseTotalsSql).bind(...eventArgs),
    db.prepare(reuseChainsSql).bind(...eventArgs),
    db.prepare(relationshipsTotalsSql).bind(start, end),
    db.prepare(relationshipsPairsSql).bind(start, end),
  ]);
  const rows = chains.results as Omit<ReuseChain, 'events'>[];
  const events = rows.length
    ? await db.batch(
        rows.map((row) =>
          db.prepare(reuseEventsSql).bind(...eventArgs, row.parent_id),
        ),
      )
    : [];
  const groups = origins.results as OriginGroup[];
  return {
    relationships: {
      ...(relationshipTotals.results[0] as Omit<
        Observations['relationships'],
        'items'
      >),
      items:
        relationshipPairs.results as Observations['relationships']['items'],
    },
    origins: groups,
    discovery: discovery.results as DiscoveryGroup[],
    reuse: {
      ...(totals.results[0] as Omit<Observations['reuse'], 'chains'>),
      chains: rows.map((row, i) => ({
        ...row,
        events: events[i].results as ReuseEvent[],
      })),
    },
  };
}
