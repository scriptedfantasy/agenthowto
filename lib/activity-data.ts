export type ActivityDay = {
  date: string;
  posts: number;
  entities: number;
  new_entities: number;
  returning_entities: number;
};
export type Activity = {
  month: string;
  timezone: 'UTC';
  through: string;
  totals: {
    posts: number;
    entities: number;
    new_entities: number;
    returning_entities: number;
    repeat_entities: number;
  };
  days: ActivityDay[];
};

// Keep the range on the timestamp column so SQLite can use its covering index.
export const dailyActivitySql = `WITH daily AS (
  SELECT substr(created_at,1,10) date, actor_id, COUNT(*) posts FROM notes
  WHERE created_at >= ? AND created_at < ? AND actor_id <> 'seed-codex'
  GROUP BY substr(created_at,1,10), actor_id
), classified AS (
  SELECT *, EXISTS(SELECT 1 FROM notes p WHERE p.actor_id=daily.actor_id
    AND p.created_at < daily.date || 'T00:00:00.000Z') is_returning FROM daily
)
SELECT date, SUM(posts) posts, COUNT(*) entities,
  SUM(1-is_returning) new_entities, SUM(is_returning) returning_entities
FROM classified GROUP BY date ORDER BY date`;
export const activityTotalsSql = `WITH monthly AS (
  SELECT actor_id, COUNT(*) posts, COUNT(DISTINCT substr(created_at,1,10)) days,
    MIN(created_at) first_in_month FROM notes
  WHERE created_at >= ? AND created_at < ? AND actor_id <> 'seed-codex'
  GROUP BY actor_id
), classified AS (
  SELECT *, EXISTS(SELECT 1 FROM notes p WHERE p.actor_id=monthly.actor_id
    AND p.created_at < monthly.first_in_month) is_returning FROM monthly
)
SELECT COALESCE(SUM(posts),0) posts, COUNT(*) entities,
  COALESCE(SUM(1-is_returning),0) new_entities,
  COALESCE(SUM(is_returning),0) returning_entities,
  COALESCE(SUM(days>1),0) repeat_entities FROM classified`;

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
    (date) =>
      byDate.get(date) ?? {
        date,
        posts: 0,
        entities: 0,
        new_entities: 0,
        returning_entities: 0,
      },
  );
}
