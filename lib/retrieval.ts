import config from '@/agenthow.config.json';
import { requestStatusProjection } from './collaboration-sql';
import type { Report } from './types';
import { ApiError } from './validation';

export type CompactNote = {
  id: string;
  origin: string;
  revision: string;
  actor_id: string;
  author: string;
  title: string;
  topic: string;
  kind: string;
  tool: string;
  version: string;
  created_at: string;
  basis: string;
  license: string;
  request?: { origin: string; revision: string } | null;
  contribution_role?: string;
  request_status?: string | null;
  excerpt: string;
  excerpt_start: number;
  excerpt_truncated: boolean;
  body_characters: number;
};
export const excerptCharacters = 600;
export function compactMarkdown(
  note: CompactNote & { url: string; fetch_url: string },
) {
  return (
    `## ${JSON.stringify(note.title)}\n` +
    Object.entries(note)
      .filter(([key]) => key !== 'title')
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')
  );
}

// Select only bounded text from D1. The first query term present in the body
// locates a verbatim excerpt; metadata-only matches use the start of the body.
export function compactProjection(query: string) {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 8);
  const position = terms.length
    ? `COALESCE(${terms.map(() => 'NULLIF(instr(lower(n.body),lower(?)),0)').join(',')},1)`
    : '1';
  const start = `MAX(1,${position}-120)`;
  return {
    sql: `n.id,n.origin,n.revision,n.actor_id,n.author,n.title,n.topic,n.kind,
      n.tool,n.version,n.created_at,n.basis,n.license,n.contribution_role,n.request_origin,n.request_revision,
      ${requestStatusProjection},
      substr(n.body,${start},${excerptCharacters}) excerpt,
      ${start}-1 excerpt_start,length(n.body) body_characters`,
    args: [...terms, ...terms],
  };
}

export function searchView(params: URLSearchParams) {
  const view = params.get('view') ?? 'full';
  if (!['full', 'compact'].includes(view))
    throw new ApiError(400, 'invalid_view', 'view must be full or compact');
  return view;
}
export function readLimit(params: URLSearchParams, name: string, minimum = 0) {
  const value = params.get(name);
  if (value === null) return 200;
  if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > 200)
    throw new ApiError(
      400,
      'invalid_limit',
      `${name} must be between ${minimum} and 200`,
    );
  return Number(value);
}

type ReportCursor = {
  v: 1;
  node: string;
  note: string;
  created_at: string;
  id: string;
};
export function decodeReportCursor(
  value: string | null,
  note: string,
): ReportCursor | null {
  if (value === null) return null;
  try {
    if (!value || value.length > 2048) throw Error();
    const parsed = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      ),
    );
    if (
      parsed.v !== 1 ||
      parsed.node !== config.origin ||
      parsed.note !== note ||
      typeof parsed.created_at !== 'string' ||
      parsed.created_at.length > 80 ||
      !Number.isFinite(Date.parse(parsed.created_at)) ||
      typeof parsed.id !== 'string' ||
      !parsed.id ||
      parsed.id.length > 256
    )
      throw Error();
    return parsed;
  } catch {
    throw new ApiError(
      400,
      'invalid_cursor',
      'Use the next_cursor returned for this note on this node',
    );
  }
}
export function encodeReportCursor(note: string, report: Report) {
  return btoa(
    String.fromCharCode(
      ...new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          node: config.origin,
          note,
          created_at: report.created_at,
          id: report.id,
        }),
      ),
    ),
  );
}
export type ReportPage = {
  items: Report[];
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};
export type ReportPageInfo = Omit<ReportPage, 'items'> & {
  included: number;
  next_url: string | null;
};

export function reportPageInfo(
  note: string,
  page: ReportPage,
  format: string,
): ReportPageInfo {
  const params = new URLSearchParams({
    limit: String(page.limit || 20),
    format,
  });
  if (page.next_cursor) params.set('cursor', page.next_cursor);
  return {
    included: page.items.length,
    limit: page.limit,
    has_more: page.has_more,
    next_cursor: page.next_cursor,
    next_url: page.has_more
      ? config.origin +
        '/notes/' +
        encodeURIComponent(note) +
        '/reports?' +
        params
      : null,
  };
}
export function nextPageUrl(
  path: string,
  params: URLSearchParams,
  cursor: string | null,
  format: string,
) {
  if (!cursor) return null;
  const next = new URLSearchParams(params);
  next.set('cursor', cursor);
  next.set('format', format);
  return config.origin + '/' + path + '.' + format + '?' + next;
}
export function paginationHeaders(next: string | null): Record<string, string> {
  return next ? { Link: `<${next}>; rel="next"` } : {};
}
export function reportMarkdown(report: Report) {
  return [
    `### Report ${report.id}`,
    `Outcome: ${report.outcome} | author: ${JSON.stringify(report.author)} | ${report.created_at}`,
    `Revision: ${JSON.stringify(report.revision)}`,
    `Context: ${JSON.stringify(report.context)}`,
    '',
    report.evidence,
  ].join('\n');
}
export function reportPageMarkdown(page: ReportPageInfo) {
  return `Reports included: ${page.included}\nhas_more: ${page.has_more}\nnext_cursor: ${page.next_cursor || 'none'}\nnext_url: ${page.next_url || 'none'}`;
}
