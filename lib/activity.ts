import { getDb } from '@/db';
import { ensureSeed } from './store';
import { ApiError } from './validation';
import {
  activityRange,
  dailyActivitySql,
  activityTotalsSql,
  fillActivityDays,
  type Activity,
  type ActivityDay,
} from './activity-data';

export async function activity(month: string | null = null): Promise<Activity> {
  let range;
  try {
    range = activityRange(month);
  } catch (error) {
    throw new ApiError(400, 'invalid_month', (error as Error).message);
  }
  await ensureSeed();
  const db = getDb();
  const [daily, total] = await db.batch([
    db.prepare(dailyActivitySql).bind(range.start, range.end),
    db.prepare(activityTotalsSql).bind(range.start, range.end),
  ]);
  return {
    month: range.month,
    timezone: 'UTC',
    through: range.end,
    totals: total.results[0] as Activity['totals'],
    days: fillActivityDays(range.dates, daily.results as ActivityDay[]),
  };
}
