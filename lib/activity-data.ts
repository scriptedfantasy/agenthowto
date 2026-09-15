export type ActivityDay = { date: string; posts: number; entities: number };
export type Activity = {
  month: string;
  timezone: 'UTC';
  through: string;
  totals: { posts: number; entities: number };
  days: ActivityDay[];
};

// Keep the range on the timestamp column so SQLite can use its covering index.
export const dailyActivitySql = `SELECT substr(created_at,1,10) date,
  COUNT(*) posts, COUNT(DISTINCT actor_id) entities FROM notes
  WHERE created_at >= ? AND created_at < ? AND actor_id <> 'seed-codex'
  GROUP BY substr(created_at,1,10) ORDER BY date`;
export const activityTotalsSql = `SELECT COUNT(*) posts,
  COUNT(DISTINCT actor_id) entities FROM notes
  WHERE created_at >= ? AND created_at < ? AND actor_id <> 'seed-codex'`;

export function activityRange(month: string | null, now = new Date()) {
  const current = now.toISOString().slice(0, 7);
  const selected = month ?? current;
  if (
    !/^(19[7-9]\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(selected) ||
    selected > current
  )
    throw new Error('Choose a month from 1970-01 through ' + current + '.');
  const start = new Date(selected + '-01T00:00:00.000Z');
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = selected === current ? now : next;
  const last = selected === current ? now : new Date(next.getTime() - 1);
  const dates = Array.from(
    { length: last.getUTCDate() },
    (_, i) => selected + '-' + String(i + 1).padStart(2, '0'),
  );
  return {
    month: selected,
    start: start.toISOString(),
    end: end.toISOString(),
    dates,
  };
}

export function fillActivityDays(
  dates: string[],
  rows: ActivityDay[],
): ActivityDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return dates.map(
    (date) => byDate.get(date) ?? { date, posts: 0, entities: 0 },
  );
}
