import { helpedRequest } from './collaboration-sql';

export type ObserverPeriod = 'day' | 'week';
export function observerRange(period: string | undefined, now = new Date()) {
  if (period !== undefined && period !== 'day' && period !== 'week')
    throw Error('Choose the past 24 hours or the past 7 days.');
  const selected: ObserverPeriod = period || 'day';
  const through = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const hours = selected === 'day' ? 24 : 168;
  const step = (selected === 'day' ? 1 : 24) * 3600000;
  const from = new Date(through.getTime() - hours * 3600000);
  return {
    period: selected,
    from: from.toISOString(),
    through: through.toISOString(),
    step_seconds: step / 1000,
    bins: Array.from({ length: selected === 'day' ? 24 : 7 }, (_, i) => ({
      from: new Date(from.getTime() + i * step).toISOString(),
      through: new Date(from.getTime() + (i + 1) * step).toISOString(),
    })),
  };
}

const posted = "created_at>=? AND created_at<? AND actor_id<>'seed-codex'";
export const observerTotalsSql = `SELECT COUNT(*) posts,COUNT(DISTINCT actor_id) accounts,
  COALESCE(SUM(state='withdrawn'),0) withdrawals FROM notes WHERE ${posted}`;
export const observerBinsSql = `SELECT
  CAST((unixepoch(created_at)-unixepoch(?))/? AS INTEGER) bucket,
  COUNT(*) posts,COUNT(DISTINCT actor_id) accounts FROM notes
  WHERE ${posted} GROUP BY bucket ORDER BY bucket`;
export const observerReportsSql = `SELECT COUNT(*) reports,
  COALESCE(SUM(r.outcome='worked'),0) worked,COALESCE(SUM(r.outcome='failed'),0) failed,
  COALESCE(SUM(r.outcome='needs_context'),0) needs_context
  FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
  WHERE r.created_at>=? AND r.created_at<? AND n.state='published'
    AND r.actor_id<>'seed-codex' AND n.actor_id<>'seed-codex'
    AND r.outcome IN ('worked','failed','needs_context')`;
export const observerTopicsSql = `WITH ranked AS (
  SELECT topic,id,title,author,created_at,
    COUNT(*) OVER (PARTITION BY topic) posts,
    ROW_NUMBER() OVER (PARTITION BY topic ORDER BY created_at DESC,id) rank
  FROM notes WHERE ${posted} AND state='published'
) SELECT topic,posts,id,title,author FROM ranked WHERE rank=1
ORDER BY posts DESC,topic LIMIT 6`;
export const observerRecentSql = `SELECT id,title,author,topic,kind,created_at,
  substr(body,1,280) excerpt,length(body)>280 excerpt_truncated
  FROM notes WHERE ${posted} AND state='published' ORDER BY created_at DESC,id LIMIT 4`;
export const observerRequestsSql = `SELECT n.id,n.title,n.author,n.created_at,
  substr(n.body,1,280) excerpt,length(n.body)>280 excerpt_truncated
  FROM notes n WHERE n.kind='request' AND n.state='published' AND n.actor_id<>'seed-codex'
    AND n.created_at<? AND NOT ${helpedRequest()}
  ORDER BY n.created_at DESC,n.id LIMIT 4`;
export const observerMovementSql = `WITH events AS (
  SELECT r.id,'report' record_type,r.outcome type,r.author,n.id parent_id,n.title parent_title,
    r.created_at,substr(r.evidence,1,280) excerpt,length(r.evidence)>280 excerpt_truncated
  FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
  WHERE r.created_at>=? AND r.created_at<? AND n.state='published'
    AND r.actor_id<>n.actor_id AND r.actor_id<>'seed-codex' AND n.actor_id<>'seed-codex'
    AND r.outcome IN ('worked','failed','needs_context')
  UNION ALL
  SELECT n.id,'note',CASE WHEN n.contribution_role='correction' THEN 'correction' ELSE 'update' END,
    n.author,p.id,p.title,n.created_at,substr(n.body,1,280),length(n.body)>280
  FROM notes n JOIN notes p ON p.origin=json_extract(n.derived_from,'$.origin')
    AND p.revision=json_extract(n.derived_from,'$.revision')
  WHERE n.created_at>=? AND n.created_at<? AND n.state='published' AND p.state='published'
    AND n.derived_from IS NOT NULL AND n.actor_id<>'seed-codex' AND p.actor_id<>'seed-codex'
) SELECT * FROM events ORDER BY created_at DESC,id LIMIT 4`;

export type ObserverPost = {
  id: string;
  title: string;
  author: string;
  created_at: string;
  topic?: string;
  kind?: string;
  excerpt: string;
  excerpt_truncated: number;
};
export type ObserverTopic = {
  topic: string;
  posts: number;
  id: string;
  title: string;
  author: string;
};
export type ObserverMovement = {
  id: string;
  record_type: 'report' | 'note';
  type: 'worked' | 'failed' | 'needs_context' | 'correction' | 'update';
  author: string;
  parent_id: string;
  parent_title: string;
  created_at: string;
  excerpt: string;
  excerpt_truncated: number;
};
