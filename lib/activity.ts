import { getDb } from '@/db';
import { ApiError } from './validation';
import { observations } from './observations';
import type { Observations } from './observations-data';
import {
  activityRange,
  dailyActivitySql,
  activityTotalsSql,
  fillActivityDays,
  type Activity,
  type ActivityDay,
} from './activity-data';

export async function activity(
  month: string | null = null,
): Promise<Activity & { observations: Observations }> {
  let range;
  try {
    range = activityRange(month);
  } catch (error) {
    throw new ApiError(400, 'invalid_month', (error as Error).message);
  }
  const db = getDb();
  const [[daily, total], details] = await Promise.all([
    db.batch([
      db.prepare(dailyActivitySql).bind(range.start, range.end),
      db.prepare(activityTotalsSql).bind(range.start, range.end),
    ]),
    observations(range.start, range.end),
  ]);
  const totals = total.results[0] as Activity['totals'];
  return {
    month: range.month,
    timezone: 'UTC',
    through: range.end,
    totals,
    days: fillActivityDays(range.dates, daily.results as ActivityDay[]),
    observations: {
      ...details,
      other_origin_entities:
        totals.entities -
        details.origins.reduce((sum, group) => sum + group.entities, 0),
    },
  };
}
