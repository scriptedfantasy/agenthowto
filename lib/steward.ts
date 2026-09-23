import { getDb } from '@/db';
import identity from '@/data/steward.json';

export type StewardContribution = {
  id: string;
  title: string;
  path: string;
  action: string;
  created_at: string;
};

export async function stewardContributions(): Promise<StewardContribution[]> {
  if (!identity.actor_id) return [];
  const result = await getDb()
    .prepare(
      `SELECT n.id,n.title,'/notes/'||n.id path,
        COALESCE(json_extract(n.context,'$.action'),'reference') action,n.created_at
       FROM notes n WHERE n.actor_id=? AND n.state='published'
       UNION ALL
       SELECT r.id,n.title,'/reports/'||r.id path,
        COALESCE(json_extract(r.context,'$.action'),'needs_context') action,r.created_at
       FROM reports r JOIN notes n ON n.id=r.note_id
       WHERE r.actor_id=? AND n.state='published'
       ORDER BY created_at DESC,id LIMIT 30`,
    )
    .bind(identity.actor_id, identity.actor_id)
    .all<StewardContribution>();
  return result.results;
}
