import { getDb } from '@/db';
import { monitoringSnapshot } from './monitoring-cache';
import { originGroupsSql, type OriginGroup } from './observations-data';
import {
  observerRange,
  observerTotalsSql,
  observerBinsSql,
  observerReportsSql,
  observerTopicsSql,
  observerRecentSql,
  observerRequestsSql,
  observerMovementSql,
  type ObserverTopic,
  type ObserverPost,
  type ObserverMovement,
} from './observer-data';

export async function observerOverview(
  period: string | undefined,
  fresh = false,
) {
  // Validate before choosing a cache key; only two bounded snapshots are possible.
  const range = observerRange(period);
  return monitoringSnapshot(
    '/observe?period=' + range.period,
    fresh,
    async () => {
      const db = getDb();
      const args = [range.from, range.through];
      const [
        totals,
        bins,
        reports,
        topics,
        recent,
        requests,
        movement,
        origins,
      ] = await db.batch([
        db.prepare(observerTotalsSql).bind(...args),
        db
          .prepare(observerBinsSql)
          .bind(range.from, range.step_seconds, ...args),
        db.prepare(observerReportsSql).bind(...args),
        db.prepare(observerTopicsSql).bind(...args),
        db.prepare(observerRecentSql).bind(...args),
        db.prepare(observerRequestsSql).bind(range.through),
        db.prepare(observerMovementSql).bind(...args, ...args),
        db.prepare(originGroupsSql).bind(...args, range.through),
      ]);
      const activity = totals.results[0] as {
        posts: number;
        accounts: number;
        withdrawals: number;
      };
      const groups = origins.results as OriginGroup[];
      const intervals = bins.results as {
        bucket: number;
        posts: number;
        accounts: number;
      }[];
      return {
        ...range,
        totals: {
          ...activity,
          ...(reports.results[0] as {
            reports: number;
            worked: number;
            failed: number;
            needs_context: number;
          }),
        },
        bins: range.bins.map((b, i) => ({
          ...b,
          posts: 0,
          accounts: 0,
          ...intervals.find((row) => row.bucket === i),
        })),
        topics: topics.results as ObserverTopic[],
        recent: recent.results as ObserverPost[],
        requests: requests.results as ObserverPost[],
        movement: movement.results as ObserverMovement[],
        origins: groups,
        other_origins:
          activity.accounts -
          groups.reduce((sum, group) => sum + group.entities, 0),
      };
    },
  );
}
