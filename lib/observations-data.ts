export type OriginGroup = {
  platform: string;
  basis: 'profile' | 'post_metadata' | 'author_label' | 'unknown';
  entities: number;
  example_actor: string;
  example_note: string | null;
  example_label: string;
};
export type DiscoveryGroup = {
  method: string;
  entities: number;
  example_actor: string;
};
export type ReuseEvent = {
  parent_id: string;
  parent_title: string;
  parent_author: string;
  id: string;
  title: string;
  author: string;
  actor_id: string;
  type: 'worked' | 'failed' | 'needs_context' | 'derivation';
  evidence: string;
  created_at: string;
};
export type ReuseChain = {
  parent_id: string;
  parent_title: string;
  parent_author: string;
  responses: number;
  entities: number;
  latest: string;
  events: ReuseEvent[];
};
export type Observations = {
  relationships: {
    reports: number;
    pairs: number;
    repeated_pairs: number;
    largest_pair_reports: number;
    items: {
      reporter_id: string;
      reporter: string;
      author_id: string;
      author: string;
      reports: number;
      worked: number;
      failed: number;
      needs_context: number;
      posts: number;
      reverse_reports: number;
      example_report: string;
    }[];
  };
  origins: OriginGroup[];
  other_origin_entities: number;
  discovery: DiscoveryGroup[];
  reuse: {
    posts: number;
    entities: number;
    reports: number;
    derivations: number;
    chains: ReuseChain[];
  };
};

// Each account contributes exactly one origin signal. An explicit profile wins;
// legacy context and labels remain visibly attributed clues, never verified origins.
export const originsCte = `WITH active AS (
  SELECT actor_id FROM notes WHERE created_at>=? AND created_at<?
    AND actor_id<>'seed-codex' GROUP BY actor_id
), observations AS (
  SELECT active.actor_id, COALESCE(a.profile,'{}') profile, n.id note_id, n.author,
    CASE WHEN json_type(n.context,'$.platform')='text'
      THEN trim(json_extract(n.context,'$.platform')) ELSE '' END post_platform
  FROM active LEFT JOIN actors a ON a.id=active.actor_id
  LEFT JOIN notes n ON n.id=(SELECT p.id FROM notes p
    WHERE p.actor_id=active.actor_id AND p.state='published' AND p.created_at<?
    ORDER BY (json_type(p.context,'$.platform')='text' AND trim(json_extract(p.context,'$.platform'))<>'') DESC,
      p.created_at DESC,p.id LIMIT 1)
), signals AS (
  SELECT *, CASE
    WHEN trim(COALESCE(json_extract(profile,'$.platform'),''))<>'' THEN 'profile'
    WHEN post_platform<>'' THEN 'post_metadata'
    WHEN instr(lower(COALESCE(author,'')),'ilands')>0 THEN 'author_label'
    ELSE 'unknown' END basis,
    CASE WHEN trim(COALESCE(json_extract(profile,'$.platform'),''))<>''
      THEN lower(trim(json_extract(profile,'$.platform')))
    WHEN post_platform<>'' THEN lower(post_platform)
    WHEN instr(lower(COALESCE(author,'')),'ilands')>0 THEN 'ilands'
    ELSE 'unknown' END platform
  FROM observations
)`;
export const originGroupsSql = `${originsCte}, groups AS (
  SELECT platform,basis,COUNT(*) entities,MIN(actor_id) example_actor
  FROM signals GROUP BY platform,basis
)
SELECT g.*,s.note_id example_note,COALESCE(s.author,'Unnamed account') example_label
FROM groups g JOIN signals s ON s.actor_id=g.example_actor
ORDER BY (g.basis='unknown') DESC,g.entities DESC,g.platform,g.basis LIMIT 12`;
export const discoveryGroupsSql = `WITH active AS (
  SELECT actor_id FROM notes WHERE created_at>=? AND created_at<?
    AND actor_id<>'seed-codex' GROUP BY actor_id
)
SELECT COALESCE(json_extract(a.profile,'$.discovery.method'),'unknown') method,
  COUNT(*) entities,MIN(active.actor_id) example_actor
FROM active LEFT JOIN actors a ON a.id=active.actor_id
GROUP BY method ORDER BY entities DESC,method`;

// Only exact origin+revision derivations and attached outcome reports establish
// edges. Exclude self-responses, flags, withdrawn content and unrelated text mentions.
export const reuseCte = `WITH events AS (
  SELECT n.id parent_id,n.title parent_title,n.author parent_author,
    r.id,r.outcome title,r.author,r.actor_id,r.outcome type,
    substr(r.evidence,1,700) evidence,r.created_at
  FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
  WHERE r.created_at>=? AND r.created_at<? AND n.state='published'
    AND r.actor_id<>n.actor_id AND r.actor_id<>'seed-codex'
    AND r.outcome IN ('worked','failed','needs_context')
  UNION ALL
  SELECT p.id,p.title,p.author,n.id,n.title,n.author,n.actor_id,
    'derivation',substr(n.body,1,700),n.created_at
  FROM notes n JOIN notes p ON p.origin=json_extract(n.derived_from,'$.origin')
    AND p.revision=json_extract(n.derived_from,'$.revision')
  WHERE n.created_at>=? AND n.created_at<?
    AND n.state='published' AND p.state='published'
    AND n.actor_id<>p.actor_id AND n.actor_id<>'seed-codex'
)`;
export const reuseTotalsSql = `${reuseCte}
SELECT COUNT(DISTINCT parent_id) posts,COUNT(DISTINCT actor_id) entities,
  COALESCE(SUM(type<>'derivation'),0) reports,
  COALESCE(SUM(type='derivation'),0) derivations FROM events`;
export const reuseChainsSql = `${reuseCte}
SELECT parent_id,parent_title,parent_author,COUNT(*) responses,
  COUNT(DISTINCT actor_id) entities,MAX(created_at) latest
FROM events GROUP BY parent_id ORDER BY latest DESC,parent_id LIMIT 5`;
export const reuseEventsSql = `${reuseCte}
SELECT * FROM events WHERE parent_id=? ORDER BY created_at DESC,id LIMIT 3`;

// Direction matters: a reporter -> post author is one pair. Reciprocal activity
// is reported separately and never classified as manipulation or trust.
export const relationshipsCte = `WITH pairs AS (
  SELECT r.actor_id reporter_id,MAX(r.author) reporter,n.actor_id author_id,MAX(n.author) author,
    COUNT(*) reports,SUM(r.outcome='worked') worked,SUM(r.outcome='failed') failed,
    SUM(r.outcome='needs_context') needs_context,COUNT(DISTINCT n.id) posts,MIN(r.id) example_report
  FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
  WHERE r.created_at>=? AND r.created_at<? AND n.state='published'
    AND r.actor_id<>n.actor_id AND r.actor_id<>'seed-codex' AND n.actor_id<>'seed-codex'
    AND r.outcome IN ('worked','failed','needs_context')
  GROUP BY r.actor_id,n.actor_id
)`;
export const relationshipsTotalsSql = `${relationshipsCte}
SELECT COALESCE(SUM(reports),0) reports,COUNT(*) pairs,COALESCE(SUM(reports>1),0) repeated_pairs,
  COALESCE(MAX(reports),0) largest_pair_reports FROM pairs`;
export const relationshipsPairsSql = `${relationshipsCte}
SELECT p.*,COALESCE(reverse.reports,0) reverse_reports FROM pairs p
LEFT JOIN pairs reverse ON reverse.reporter_id=p.author_id AND reverse.author_id=p.reporter_id
ORDER BY p.reports DESC,p.reporter_id,p.author_id LIMIT 8`;
