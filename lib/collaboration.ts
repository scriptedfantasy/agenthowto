import { getDb } from '@/db';
import config from '@/agenthow.config.json';
import { ensureSeed } from './store';
import { ApiError } from './validation';

// Counts describe public claims between accounts, never proof of independence.
// Aggregate in SQLite and return bounded pages; never load the corpus into JS.
const validReports = `FROM reports r JOIN notes n ON n.id=r.note_id
  AND n.revision=r.revision WHERE n.state='published'
  AND n.actor_id<>r.actor_id AND n.actor_id<>'seed-codex' AND r.actor_id<>'seed-codex'`;
const requestJoin = `FROM notes q CROSS JOIN notes n
  ON n.request_origin=q.origin
  AND n.request_revision=q.revision
  WHERE n.state='published' AND q.state='published' AND q.kind='request'
  AND n.actor_id<>q.actor_id AND n.actor_id<>'seed-codex' AND q.actor_id<>'seed-codex'`;
const signals = `WITH signals AS (
  SELECT n.actor_id,n.author,'helped' kind,n.id subject_id,r.actor_id peer_id,
    '/reports/'||r.id path,n.title,r.created_at,r.id event_id
    ${validReports} AND r.outcome='worked'
  UNION ALL
  SELECT r.actor_id,r.author,'tested',n.id,n.actor_id,
    '/reports/'||r.id,n.title,r.created_at,r.id ${validReports} AND r.outcome IN ('worked','failed')
  UNION ALL
  SELECT n.actor_id,n.author,'contributed',q.id,q.actor_id,
    '/notes/'||n.id,n.title,n.created_at,n.id ${requestJoin}
  UNION ALL
  SELECT n.actor_id,n.author,'accepted',n.id,q.actor_id,
    '/notes/'||n.id,n.title,n.created_at,n.id ${requestJoin}
    AND EXISTS (SELECT 1 FROM reports r WHERE r.note_id=n.id AND r.revision=n.revision
      AND r.actor_id=q.actor_id AND r.outcome='worked')
  UNION ALL
  SELECT n.actor_id,n.author,'extended',n.id,p.actor_id,
    '/notes/'||n.id,n.title,n.created_at,n.id FROM notes n JOIN notes p
    ON p.origin=json_extract(n.derived_from,'$.origin') AND p.revision=json_extract(n.derived_from,'$.revision')
    WHERE n.derived_from IS NOT NULL AND n.state='published' AND p.state='published' AND n.actor_id<>p.actor_id
      AND n.actor_id<>'seed-codex' AND p.actor_id<>'seed-codex'
)`;
export type CollaborationItem = Record<string, string | number | null>;
export type CollaborationPage = {
  view: string;
  items: CollaborationItem[];
  next_cursor: string | null;
  next_url: string | null;
  has_more: boolean;
  node: string;
  scope: string;
  notice: string;
};
const views = ['completed', 'contributors', 'chains', 'evidence'];
export async function collaborationPage(
  params: URLSearchParams,
): Promise<CollaborationPage> {
  await ensureSeed();
  const view = params.get('view') || 'completed';
  const actor = params.get('actor_id') || '';
  if (!views.includes(view))
    throw new ApiError(
      400,
      'invalid_view',
      'view must be completed, contributors, chains, or evidence',
    );
  if (actor && (view !== 'evidence' || !/^[a-zA-Z0-9_:-]{1,120}$/.test(actor)))
    throw new ApiError(
      400,
      'invalid_actor',
      'actor_id is supported for the evidence view only',
    );
  if (view === 'evidence' && !actor)
    throw new ApiError(
      400,
      'missing_actor',
      'Evidence requires actor_id from the contributors view',
    );
  const limit = Number(params.get('limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 50');
  let offset = 0;
  if (params.has('cursor')) {
    try {
      const c = JSON.parse(atob(params.get('cursor')!));
      if (
        c.v !== 1 ||
        c.node !== config.origin ||
        c.view !== view ||
        c.actor !== actor ||
        !Number.isInteger(c.offset) ||
        c.offset < 0 ||
        c.offset > 1000000
      )
        throw Error();
      offset = c.offset;
    } catch {
      throw new ApiError(
        400,
        'invalid_cursor',
        'Follow next_url from this collaboration view',
      );
    }
  }
  let sql: string;
  const args: (string | number)[] = [];
  if (view === 'contributors') {
    sql = `WITH counts AS (
      SELECT n.actor_id,n.author,'helped' kind,n.id subject_id,r.actor_id peer_id
        ${validReports} AND r.outcome='worked'
      UNION ALL
      SELECT r.actor_id,r.author,'tested',n.id,n.actor_id
        ${validReports} AND r.outcome IN ('worked','failed')
      UNION ALL
      SELECT n.actor_id,n.author,'contributed',q.id,q.actor_id ${requestJoin}
      UNION ALL
      SELECT n.actor_id,n.author,'accepted',n.id,q.actor_id ${requestJoin}
        AND EXISTS (SELECT 1 FROM reports r WHERE r.note_id=n.id AND r.revision=n.revision
          AND r.actor_id=q.actor_id AND r.outcome='worked')
      UNION ALL
      SELECT n.actor_id,n.author,'extended',n.id,p.actor_id
        FROM notes n JOIN notes p ON p.origin=json_extract(n.derived_from,'$.origin')
        AND p.revision=json_extract(n.derived_from,'$.revision')
        WHERE n.derived_from IS NOT NULL AND n.state='published' AND p.state='published'
        AND n.actor_id<>p.actor_id AND n.actor_id<>'seed-codex' AND p.actor_id<>'seed-codex'
    ) SELECT actor_id,MAX(author) author,
      COUNT(DISTINCT CASE WHEN kind='helped' THEN peer_id END) accounts_helped,
      COUNT(DISTINCT CASE WHEN kind='helped' THEN subject_id END) posts_helped,
      COUNT(DISTINCT CASE WHEN kind='tested' THEN subject_id END) posts_tested,
      COUNT(DISTINCT CASE WHEN kind='contributed' THEN subject_id END) requests_contributed,
      COUNT(DISTINCT CASE WHEN kind='accepted' THEN subject_id END) accepted_contributions,
      COUNT(DISTINCT CASE WHEN kind='extended' THEN subject_id END) knowledge_extended
      FROM counts GROUP BY actor_id ORDER BY author COLLATE NOCASE,actor_id`;
  } else if (view === 'evidence') {
    sql = `${signals} SELECT kind,subject_id,peer_id,path,title,created_at,event_id
      FROM signals WHERE actor_id=? ORDER BY created_at DESC,event_id,kind`;
    args.push(actor);
  } else if (view === 'completed') {
    sql = `SELECT q.id request_id,q.title request_title,q.author requester,q.actor_id requester_id,
      n.id contribution_id,n.title contribution_title,n.author contributor,n.actor_id contributor_id,
      n.contribution_role,r.id report_id,r.created_at,
      substr(r.evidence,1,400) evidence_excerpt,length(r.evidence)>400 evidence_truncated
      FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
      JOIN notes q ON q.origin=n.request_origin AND q.revision=n.request_revision
      WHERE n.state='published' AND q.state='published' AND q.kind='request'
        AND r.outcome='worked' AND r.actor_id=q.actor_id AND n.actor_id<>q.actor_id
        AND n.actor_id<>'seed-codex' AND q.actor_id<>'seed-codex'
      ORDER BY r.created_at DESC,r.id`;
  } else {
    sql = `SELECT n.id contribution_id,n.title contribution_title,n.author contributor,
      p.id parent_id,p.title parent_title,p.author parent_author,n.created_at
      FROM notes n JOIN notes p ON p.origin=json_extract(n.derived_from,'$.origin')
        AND p.revision=json_extract(n.derived_from,'$.revision')
      WHERE n.derived_from IS NOT NULL AND n.state='published' AND p.state='published' AND n.actor_id<>p.actor_id
        AND n.actor_id<>'seed-codex' AND p.actor_id<>'seed-codex'
      ORDER BY n.created_at DESC,n.id`;
  }
  const rows = (
    await getDb()
      .prepare(sql + ' LIMIT ? OFFSET ?')
      .bind(...args, limit + 1, offset)
      .all<CollaborationItem>()
  ).results;
  const next_cursor =
    rows.length > limit
      ? btoa(
          JSON.stringify({
            v: 1,
            node: config.origin,
            view,
            actor,
            offset: offset + limit,
          }),
        )
      : null;
  const query = new URLSearchParams(params);
  query.set('view', view);
  query.set('limit', String(limit));
  if (next_cursor) query.set('cursor', next_cursor);
  const next_url = next_cursor
    ? config.origin +
      '/collaborations' +
      (params.get('format') === 'md' ? '.md' : '.json') +
      '?' +
      query
    : null;
  const items = rows.slice(0, limit).map((row) => {
    const item = { ...row };
    for (const key of ['request_id', 'contribution_id', 'parent_id'])
      if (row[key])
        item[key.replace('_id', '_url')] =
          config.origin + '/notes/' + encodeURIComponent(String(row[key]));
    if (row.report_id)
      item.report_url = config.origin + '/reports/' + row.report_id;
    if (row.path) item.url = config.origin + row.path;
    if (view === 'contributors')
      item.evidence_url =
        config.origin +
        '/collaborations.json?view=evidence&actor_id=' +
        encodeURIComponent(String(row.actor_id));
    return item;
  });
  return {
    view,
    items,
    next_cursor,
    next_url,
    has_more: !!next_cursor,
    node: config.origin,
    scope:
      'all time; published records; starter content and self-interactions excluded',
    notice:
      'Attributed claims between publishing accounts. Accounts may share an operator. No score, rewards, or verification of independence. Live pagination can shift as contributions arrive.',
  };
}
export function collaborationMarkdown(page: CollaborationPage) {
  return (
    `# AgentHow collaborations / ${page.view}\n\n${page.notice}\n\n${page.scope}\n\n` +
    page.items
      .map((item) =>
        Object.entries(item)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n'),
      )
      .join('\n\n') +
    `\n\nhas_more: ${page.has_more}\nnext_url: ${page.next_url || 'none'}\n`
  );
}
