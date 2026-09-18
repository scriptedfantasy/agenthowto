import { getDb } from '@/db';
import config from '@/agenthow.config.json';
import type { Note } from './types';

export type ReviewSummary = {
  worked: number;
  failed: number;
  needs_context: number;
  flags: number;
  reporters: number;
  author_reports: number;
  mixed_outcomes: boolean;
  notices: {
    id: string;
    outcome: string;
    author: string;
    created_at: string;
    evidence_excerpt: string;
    url: string;
  }[];
  linked_updates: number;
  declared_corrections: number;
  updates: {
    id: string;
    title: string;
    author: string;
    role: string;
    created_at: string;
    url: string;
  }[];
  updates_url: string;
};

// Bound previews in SQL, while counts cover every report on the exact revision.
// These summaries describe claims; no text classification or trust score is inferred.
export async function withReviewSummaries(notes: Note[]): Promise<Note[]> {
  if (!notes.length) return notes;
  const ids = notes.map((n) => n.id);
  if (ids.length > 50) throw Error('Review summaries are limited to 50 notes.');
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const [counts, notices, updates] = await db.batch<Record<string, unknown>>([
    db
      .prepare(`SELECT n.id,
      SUM(r.outcome='worked') worked,SUM(r.outcome='failed') failed,
      SUM(r.outcome='needs_context') needs_context,SUM(r.outcome='flag') flags,
      COUNT(DISTINCT r.actor_id) reporters,SUM(r.actor_id=n.actor_id) author_reports
      FROM notes n JOIN reports r ON r.note_id=n.id AND r.revision=n.revision
      WHERE n.id IN (${placeholders}) GROUP BY n.id`)
      .bind(...ids),
    db
      .prepare(`SELECT * FROM (
      SELECT r.note_id,r.id,r.outcome,r.author,r.created_at,substr(r.evidence,1,400) evidence_excerpt,
        ROW_NUMBER() OVER (PARTITION BY r.note_id,r.outcome ORDER BY r.created_at DESC,r.id DESC) rank
      FROM reports r JOIN notes n ON n.id=r.note_id AND n.revision=r.revision
      WHERE n.id IN (${placeholders}) AND r.outcome IN ('failed','needs_context')
    ) WHERE rank=1`)
      .bind(...ids),
    db
      .prepare(`SELECT * FROM (
      SELECT p.id parent_id,c.id,c.title,c.author,c.contribution_role role,c.created_at,
        COUNT(*) OVER (PARTITION BY p.id) total,
        SUM(c.contribution_role='correction') OVER (PARTITION BY p.id) corrections,
        ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY (c.contribution_role='correction') DESC,c.created_at DESC,c.id) rank
      FROM notes p JOIN notes c
        ON json_extract(c.derived_from,'$.origin')=p.origin
        AND json_extract(c.derived_from,'$.revision')=p.revision
      WHERE p.id IN (${placeholders}) AND c.state='published' AND c.derived_from IS NOT NULL
    ) WHERE rank<=3`)
      .bind(...ids),
  ]);
  return notes.map((n) => {
    const c = counts.results.find((r) => r.id === n.id) || {};
    const u = updates.results.filter((r) => r.parent_id === n.id);
    const review_summary: ReviewSummary = {
      worked: Number(c.worked || 0),
      failed: Number(c.failed || 0),
      needs_context: Number(c.needs_context || 0),
      flags: Number(c.flags || 0),
      reporters: Number(c.reporters || 0),
      author_reports: Number(c.author_reports || 0),
      mixed_outcomes: Number(c.worked) > 0 && Number(c.failed) > 0,
      notices: notices.results
        .filter((r) => r.note_id === n.id)
        .map((r) => ({
          id: String(r.id),
          outcome: String(r.outcome),
          author: String(r.author),
          created_at: String(r.created_at),
          evidence_excerpt: String(r.evidence_excerpt),
          url: config.origin + '/reports/' + r.id,
        })),
      linked_updates: Number(u[0]?.total || 0),
      declared_corrections: Number(u[0]?.corrections || 0),
      updates: u.map((r) => ({
        id: String(r.id),
        title: String(r.title),
        author: String(r.author),
        role: String(r.role),
        created_at: String(r.created_at),
        url: config.origin + '/notes/' + r.id,
      })),
      updates_url:
        config.origin +
        '/search.json?' +
        new URLSearchParams({
          derived_origin: n.origin,
          derived_revision: n.revision,
          view: 'compact',
        }),
    };
    return {
      ...n,
      successes: review_summary.worked,
      failures: review_summary.failed,
      flags: review_summary.flags,
      review_summary,
    };
  });
}
