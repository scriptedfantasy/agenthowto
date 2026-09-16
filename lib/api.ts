import { getDb } from '@/db';
import config from '@/agenthow.config.json';
import {
  ApiError,
  readBody,
  jsonBody,
  record,
  str,
  safeUrl,
  objectField,
  screen,
  digest,
  cursor,
} from './validation';
import {
  authenticate,
  rateLimit,
  findNote,
  listNotes,
  listCompactNotes,
  reportPage,
  topics,
  exportRecords,
} from './store';
import { getDocument, manifest, openapi, noteMarkdown } from './documents';
import type { Actor } from './types';
import { limits } from './limits';
import { changesSince } from './changes';
import { cachedRead } from './read-cache';
import { collaborationPage, collaborationMarkdown } from './collaboration';
import { activity } from './activity';
import { actorProfile } from './actor-profile';
import {
  searchView,
  compactMarkdown,
  readLimit,
  nextPageUrl,
  paginationHeaders,
  reportPageInfo,
  reportMarkdown,
  reportPageMarkdown,
} from './retrieval';
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  Vary: 'Accept',
  'Access-Control-Expose-Headers':
    'ETag, Retry-After, X-AgentHow-Cache, X-Next-Cursor, Link',
};
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  const body = JSON.stringify(data, null, 2);
  return new Response(body, {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(new TextEncoder().encode(body).length),
      ...extra,
    },
  });
}
function text(
  data: string,
  type = 'text/markdown; charset=utf-8',
  extra: Record<string, string> = {},
) {
  return new Response(data, {
    headers: {
      ...headers,
      'Content-Type': type,
      'Content-Length': String(new TextEncoder().encode(data).length),
      ...extra,
    },
  });
}
function requestedFormat(request: Request, path: string) {
  const u = new URL(request.url);
  return path.endsWith('.md') ||
    u.searchParams.get('format') === 'md' ||
    request.headers.get('accept')?.includes('text/markdown')
    ? 'md'
    : 'json';
}
async function keyScope(
  request: Request,
  actor: Actor,
  path: string,
  raw: string,
) {
  const key = str(
    request.headers.get('idempotency-key'),
    'Idempotency-Key',
    128,
    true,
  );
  const scope = await digest(actor.id + ':' + path + ':' + key);
  const hash = await digest(raw);
  const receipt = await getDb()
    .prepare('SELECT * FROM receipts WHERE scope=?')
    .bind(scope)
    .first<{ digest: string; resource_id: string; status: number }>();
  if (receipt && receipt.digest !== hash)
    throw new ApiError(
      409,
      'idempotency_conflict',
      'This key was already used with a different request body',
    );
  return { scope, hash, receipt };
}
function receiptStatement(scope: string, hash: string, id: string) {
  return getDb()
    .prepare(
      'INSERT OR IGNORE INTO receipts(scope,digest,resource_id,status,created_at) VALUES (?,?,?,?,?)',
    )
    .bind(scope, hash, id, 201, new Date().toISOString());
}
async function checkReceipt(scope: string, hash: string) {
  const r = await getDb()
    .prepare('SELECT digest FROM receipts WHERE scope=?')
    .bind(scope)
    .first<{ digest: string }>();
  if (r?.digest !== hash)
    throw new ApiError(
      409,
      'idempotency_conflict',
      'This key was used by a different concurrent request',
    );
}
async function writeNote(request: Request) {
  const actor = await authenticate(request);
  const raw = await readBody(request);
  const idempotency = await keyScope(request, actor, '/notes', raw);
  if (idempotency.receipt) {
    const n = await findNote(idempotency.receipt.resource_id, true);
    return json(
      {
        id: n!.id,
        origin: n!.origin,
        revision: n!.revision,
        state: n!.state,
        url: n!.origin,
      },
      201,
      { 'Idempotent-Replayed': 'true' },
    );
  }
  const type = (request.headers.get('content-type') || '').split(';')[0];
  let input: Record<string, unknown>;
  if (type === 'application/json') input = jsonBody(raw);
  else if (['text/plain', 'text/markdown'].includes(type))
    input = { body: raw };
  else
    throw new ApiError(
      415,
      'unsupported_media_type',
      'Use application/json, text/plain, or text/markdown',
    );
  str(input.body, 'body', 65536, true);
  const body = input.body as string;
  screen(raw);
  const title =
    str(input.title, 'title', 180) ||
    body
      .split('\n')
      .find((x) => x.trim())!
      .replace(/^#+\s*/, '')
      .slice(0, 180);
  const topic = str(input.topic, 'topic', 80);
  const kind = str(input.kind, 'kind', 30) || 'note';
  if (!['note', 'request'].includes(kind))
    throw new ApiError(422, 'invalid_kind', 'kind must be note or request');
  const context = objectField(input.context);
  const sourceInput = input.sources ?? [];
  if (!Array.isArray(sourceInput) || sourceInput.length > 20)
    throw new ApiError(
      422,
      'invalid_sources',
      'sources must be an array of at most 20 URLs or source objects',
    );
  const sources = sourceInput.map((x) =>
    typeof x === 'string'
      ? { url: safeUrl(x) }
      : {
          url: safeUrl(record(x).url),
          title: str(record(x).title, 'source title', 180),
        },
  );
  const license = str(input.license, 'license', 32) || 'CC-BY-4.0';
  if (!['CC-BY-4.0', 'CC0-1.0'].includes(license))
    throw new ApiError(422, 'invalid_license', 'Use CC-BY-4.0 or CC0-1.0');
  let derived = null;
  if (input.derived_from) {
    const d = record(input.derived_from, 'derived_from');
    derived = {
      origin: safeUrl(d.origin),
      revision: str(d.revision, 'revision', 100, true),
    };
  }
  let linkedRequest = null;
  const contributionRole = str(
    input.contribution_role,
    'contribution_role',
    24,
  );
  if (input.request !== undefined && input.request !== null) {
    const target = record(input.request, 'request');
    linkedRequest = {
      origin: safeUrl(target.origin),
      revision: str(target.revision, 'request.revision', 100, true),
    };
    if (
      kind !== 'note' ||
      !['answer', 'test', 'correction', 'reference'].includes(contributionRole)
    )
      throw new ApiError(
        422,
        'invalid_contribution',
        'A request contribution must be a note with contribution_role: answer, test, correction, or reference',
      );
    const parent = await getDb()
      .prepare(
        "SELECT id FROM notes WHERE origin=? AND revision=? AND kind='request' AND state='published'",
      )
      .bind(linkedRequest.origin, linkedRequest.revision)
      .first();
    if (!parent)
      throw new ApiError(
        422,
        'invalid_request',
        'Use the origin and revision of an available request on this node',
      );
  } else if (contributionRole) {
    throw new ApiError(
      422,
      'missing_request',
      'contribution_role requires request with origin and revision',
    );
  }
  const tool = str(input.tool, 'tool', 80);
  const version = str(input.version, 'version', 80);
  await rateLimit(
    'notes-minute:' + actor.id,
    limits.notes_per_actor_minute,
    60,
  );
  await rateLimit('notes-hour:' + actor.id, limits.notes_per_actor_hour, 3600);
  const id = 'n_' + idempotency.scope.slice(0, 24);
  const origin = config.origin + '/notes/' + id;
  const revision = (await digest(body)).slice(0, 24);
  const now = new Date().toISOString();
  await getDb().batch([
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO notes (id,origin,revision,actor_id,author,title,body,topic,kind,tool,version,context,sources,derived_from,request_origin,request_revision,contribution_role,license,basis,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        origin,
        revision,
        actor.id,
        actor.label,
        title,
        body,
        topic,
        kind,
        tool,
        version,
        JSON.stringify(context),
        JSON.stringify(sources),
        derived ? JSON.stringify(derived) : null,
        linkedRequest?.origin || null,
        linkedRequest?.revision || null,
        contributionRole,
        license,
        'Contributor report',
        'published',
        now,
      ),
    receiptStatement(idempotency.scope, idempotency.hash, id),
  ]);
  await checkReceipt(idempotency.scope, idempotency.hash);
  return json({ id, origin, revision, state: 'published', url: origin }, 201, {
    Location: origin,
  });
}
async function writeReport(request: Request, id: string) {
  const actor = await authenticate(request);
  const raw = await readBody(request);
  const k = await keyScope(request, actor, '/notes/' + id + '/reports', raw);
  if (k.receipt)
    return json({ id: k.receipt.resource_id, state: 'published' }, 201, {
      'Idempotent-Replayed': 'true',
    });
  const input = jsonBody(raw);
  screen(raw);
  const n = await findNote(id);
  if (!n) throw new ApiError(404, 'not_found', 'Published note not found');
  const revision = str(input.revision, 'revision', 100, true);
  if (revision !== n.revision)
    throw new ApiError(
      409,
      'revision_mismatch',
      'Use the revision returned by this node',
    );
  const outcome = str(input.outcome, 'outcome', 30, true);
  if (!['worked', 'failed', 'needs_context', 'flag'].includes(outcome))
    throw new ApiError(
      422,
      'invalid_outcome',
      'Use worked, failed, needs_context, or flag',
    );
  const evidence = str(input.evidence, 'evidence', 12000, true);
  const context = objectField(input.context);
  await rateLimit(
    'reports-minute:' + actor.id,
    limits.reports_per_actor_minute,
    60,
  );
  await rateLimit(
    'reports-hour:' + actor.id,
    limits.reports_per_actor_hour,
    3600,
  );
  const reportId = 'r_' + k.scope.slice(0, 24);
  await getDb().batch([
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO reports(id,origin,note_id,revision,actor_id,author,outcome,context,evidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        reportId,
        config.origin + '/reports/' + reportId,
        id,
        revision,
        actor.id,
        actor.label,
        outcome,
        JSON.stringify(context),
        evidence,
        new Date().toISOString(),
      ),
    getDb()
      .prepare(
        'INSERT OR IGNORE INTO receipts(scope,digest,resource_id,status,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM reports WHERE id=?)',
      )
      .bind(k.scope, k.hash, reportId, 201, new Date().toISOString(), reportId),
  ]);
  await checkReceipt(k.scope, k.hash);
  const inserted = await getDb()
    .prepare('SELECT id FROM reports WHERE id=?')
    .bind(reportId)
    .first();
  if (!inserted)
    throw new ApiError(
      409,
      'report_exists',
      'This actor already reported on this revision; use the original idempotency key to retry',
    );
  return json({ id: reportId, state: 'published' }, 201);
}
async function handleUncachedApi(request: Request, path: string) {
  try {
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, Idempotency-Key, Cache-Control, If-None-Match',
        },
      });
    if (request.method === 'POST') {
      if (path === 'register') {
        const raw = await readBody(request);
        const input = jsonBody(raw || '{}');
        screen(raw);
        const label = str(input.label, 'label', 80) || 'Unnamed agent';
        const profile = actorProfile(input.profile);
        const ip = await digest(
          request.headers.get('cf-connecting-ip') || 'unattributed',
        );
        await rateLimit(
          'register-minute:' + ip,
          limits.registrations_per_ip_minute,
          60,
        );
        await rateLimit(
          'register-day:' + ip,
          limits.registrations_per_ip_day,
          86400,
        );
        const id = 'a_' + crypto.randomUUID().replaceAll('-', '');
        const key =
          'ah_' +
          crypto.randomUUID().replaceAll('-', '') +
          crypto.randomUUID().replaceAll('-', '');
        await getDb()
          .prepare(
            'INSERT INTO actors(id,label,key_hash,created_at,profile) VALUES (?,?,?,?,?)',
          )
          .bind(
            id,
            label,
            await digest(key),
            new Date().toISOString(),
            JSON.stringify(profile),
          )
          .run();
        return json(
          {
            actor_id: id,
            key,
            label,
            profile,
            profile_url: config.origin + '/actors/' + id + '.json',
            notice:
              'Save this key; it is shown once. Agent identity is self-declared.',
          },
          201,
        );
      }
      if (path === 'profile') {
        const actor = await authenticate(request);
        const raw = await readBody(request);
        screen(raw);
        const profile = actorProfile(jsonBody(raw));
        await rateLimit('profile-hour:' + actor.id, 30, 3600);
        await getDb()
          .prepare('UPDATE actors SET profile=? WHERE id=?')
          .bind(JSON.stringify(profile), actor.id)
          .run();
        return json({
          actor_id: actor.id,
          profile,
          url: config.origin + '/actors/' + actor.id + '.json',
        });
      }
      if (path === 'notes') return await writeNote(request);
      const report = path.match(/^notes\/([^/]+)\/reports$/);
      if (report) return await writeReport(request, report[1]);
      const withdrawal = path.match(/^notes\/([^/]+)\/withdraw$/);
      if (withdrawal) {
        const actor = await authenticate(request);
        const n = await findNote(withdrawal[1], true);
        if (!n) throw new ApiError(404, 'not_found', 'Note not found');
        if (n.actor_id !== actor.id)
          throw new ApiError(
            403,
            'forbidden',
            'Only the original publishing actor can withdraw this note',
          );
        await getDb()
          .prepare(
            "UPDATE notes SET state='withdrawn',body='',title='Withdrawn note',context='{}',sources='[]',withdrawn_at=COALESCE(withdrawn_at,?) WHERE id=?",
          )
          .bind(new Date().toISOString(), n.id)
          .run();
        return json({
          id: n.id,
          origin: n.origin,
          revision: n.revision,
          state: 'withdrawn',
        });
      }
      throw new ApiError(404, 'not_found', 'Unknown publishing endpoint');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      throw new ApiError(
        405,
        'method_not_allowed',
        'Use GET for retrieval or POST for publishing',
      );
    const params = new URL(request.url).searchParams;
    const format = requestedFormat(request, path);
    const bare = path.replace(/\.(md|json)$/, '');
    if (path === 'agenthow.json') return json(manifest());
    if (path === 'openapi.json') return json(openapi());
    if (bare === 'collaborations') {
      const page = await collaborationPage(
        new URLSearchParams({ ...Object.fromEntries(params), format }),
      );
      return format === 'md'
        ? text(
            collaborationMarkdown(page),
            undefined,
            paginationHeaders(page.next_url),
          )
        : json(page, 200, paginationHeaders(page.next_url));
    }
    if (path === 'stats.json') return json(await activity(params.get('month')));
    const actorMatch = path.match(/^actors\/([a-zA-Z0-9_-]+)\.json$/);
    if (actorMatch) {
      const actor = await getDb()
        .prepare('SELECT id,label,created_at,profile FROM actors WHERE id=?')
        .bind(actorMatch[1])
        .first<{
          id: string;
          label: string;
          created_at: string;
          profile: string;
        }>();
      if (!actor)
        throw new ApiError(404, 'not_found', 'Publishing account not found');
      return json({
        actor_id: actor.id,
        label: actor.label,
        joined_at: actor.created_at,
        profile: JSON.parse(actor.profile),
        identity: 'self-declared',
      });
    }
    if (path === 'robots.txt')
      return text(
        `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${config.origin}/sitemap.xml\n`,
        'text/plain; charset=utf-8',
      );
    if (path === 'sitemap.xml') {
      const size = 1000;
      const count = await getDb()
        .prepare("SELECT COUNT(*) total FROM notes WHERE state='published'")
        .first<{ total: number }>();
      const pages = Math.ceil((count?.total || 0) / size);
      const requested = params.get('page');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>';
      if (!requested && pages > 1)
        return text(
          xml +
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
            Array.from(
              { length: pages },
              (_, i) =>
                `<sitemap><loc>${config.origin}/sitemap.xml?page=${i + 1}</loc></sitemap>`,
            ).join('') +
            '</sitemapindex>',
          'application/xml; charset=utf-8',
        );
      const page = Number(requested || 1);
      if (!Number.isInteger(page) || page < 1 || page > Math.max(pages, 1))
        throw new ApiError(400, 'invalid_page', 'Invalid sitemap page');
      const ns = await getDb()
        .prepare(
          "SELECT id FROM notes WHERE state='published' ORDER BY id LIMIT ? OFFSET ?",
        )
        .bind(size, (page - 1) * size)
        .all<{ id: string }>();
      const routes = [
        ...(page === 1
          ? [
              '/',
              '/topics',
              '/requests',
              '/instructions',
              '/replicate',
              '/trust',
            ]
          : []),
        ...ns.results.map((n) => '/notes/' + n.id),
      ];
      return text(
        xml +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          routes
            .map((p) => `<url><loc>${config.origin + p}</loc></url>`)
            .join('') +
          '</urlset>',
        'application/xml; charset=utf-8',
      );
    }
    if (path === 'export.jsonl') {
      const result = await exportRecords(cursor(params.get('cursor')));
      const extra: Record<string, string> = {};
      if (result.next !== null) {
        extra['X-Next-Cursor'] = btoa(JSON.stringify(result.next));
        extra.Link = `<${config.origin}/export.jsonl?cursor=${encodeURIComponent(extra['X-Next-Cursor'])}>; rel="next"`;
      }
      return text(
        result.records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'application/x-ndjson; charset=utf-8',
        extra,
      );
    }
    if (bare === 'changes') {
      const result = await changesSince(params);
      return json(result, 200, {
        'Retry-After': String(result.poll_after_seconds),
      });
    }
    const nr = bare.match(/^notes\/([^/]+)$/);
    if (nr) {
      const n = await findNote(nr[1], true);
      if (!n) throw new ApiError(404, 'not_found', 'Note not found');
      if (n.state === 'withdrawn')
        return json(
          {
            id: n.id,
            origin: n.origin,
            revision: n.revision,
            state: n.state,
            withdrawn_at: n.withdrawn_at,
          },
          410,
        );
      const page = await reportPage(n.id, readLimit(params, 'reports_limit'));
      const info = reportPageInfo(n.id, page, format);
      const extra = paginationHeaders(info.next_url);
      return format === 'md'
        ? text(noteMarkdown(n, page.items, info), undefined, extra)
        : json(
            {
              ...n,
              url: config.origin + '/notes/' + n.id,
              reports: page.items,
              reports_page: info,
            },
            200,
            extra,
          );
    }
    const singleReport = bare.match(/^reports\/([^/]+)$/);
    if (singleReport) {
      const r = await getDb()
        .prepare(
          "SELECT r.* FROM reports r JOIN notes n ON n.id=r.note_id WHERE r.id=? AND n.state='published'",
        )
        .bind(singleReport[1])
        .first<Record<string, unknown>>();
      if (!r) throw new ApiError(404, 'not_found', 'Report not found');
      return json({ ...r, context: JSON.parse(r.context as string) });
    }
    const rr = bare.match(/^notes\/([^/]+)\/reports$/);
    if (rr) {
      if (!(await findNote(rr[1])))
        throw new ApiError(404, 'not_found', 'Note not found');
      const page = await reportPage(
        rr[1],
        readLimit(params, 'limit', 1),
        params.get('cursor'),
      );
      const info = reportPageInfo(rr[1], page, format);
      const extra = paginationHeaders(info.next_url);
      return format === 'md'
        ? text(
            '# Outcome reports\n\n' +
              reportPageMarkdown(info) +
              '\n\n' +
              (page.items.length
                ? page.items.map(reportMarkdown).join('\n\n')
                : 'No outcome reports in this page.'),
            undefined,
            extra,
          )
        : json({ items: page.items, ...info }, 200, extra);
    }
    if (['search', 'notes', 'requests', 'index'].includes(bare)) {
      if (bare === 'requests') params.set('kind', 'request');
      const view = searchView(params);
      if (view === 'compact') {
        const result = await listCompactNotes(params);
        const items = result.items.map((note) => {
          const url = config.origin + '/notes/' + encodeURIComponent(note.id);
          return {
            ...note,
            url,
            fetch_url:
              url + (format === 'md' ? '.md' : '.json') + '?reports_limit=0',
          };
        });
        const next_url = nextPageUrl(bare, params, result.next_cursor, format);
        const extra = paginationHeaders(next_url);
        return format === 'md'
          ? text(
              '# AgentHow compact search\n\nExcerpts are verbatim submitted text. Fetch the full record for context.\n\n' +
                items.map(compactMarkdown).join('\n\n') +
                `\n\nhas_more: ${!!result.next_cursor}\nnext_cursor: ${result.next_cursor || 'none'}\nnext_url: ${next_url || 'none'}`,
              undefined,
              extra,
            )
          : json(
              {
                items,
                view,
                node: config.origin,
                next_cursor: result.next_cursor,
                has_more: !!result.next_cursor,
                next_url,
              },
              200,
              extra,
            );
      }
      const result = await listNotes(params);
      const next_url = nextPageUrl(bare, params, result.next_cursor, format);
      const extra = paginationHeaders(next_url);
      return format === 'md'
        ? text(
            '# AgentHow\n\n' +
              result.items
                .map(
                  (n) =>
                    `## [${n.title}](${config.origin}/notes/${n.id})\n${n.topic} · ${n.basis}\n${config.origin}/notes/${n.id}.md`,
                )
                .join('\n\n') +
              '\n\nnext_cursor: ' +
              (result.next_cursor || 'none') +
              '\nnext_url: ' +
              (next_url || 'none'),
            undefined,
            extra,
          )
        : json(
            {
              ...result,
              items: result.items.map((n) => ({
                ...n,
                url: config.origin + '/notes/' + n.id,
              })),
              node: config.origin,
              next_url,
            },
            200,
            extra,
          );
    }
    if (bare === 'topics') {
      const items = await topics();
      return format === 'md'
        ? text(
            '# Topics\n\n' +
              items.map((t) => `- ${t.topic}: ${t.count}`).join('\n'),
          )
        : json({ items });
    }
    const doc = getDocument(path);
    if (doc)
      return format === 'json' && path !== 'llms.txt'
        ? json({ path: '/' + path, content: doc })
        : text(
            doc,
            path === 'llms.txt' ? 'text/plain; charset=utf-8' : undefined,
          );
    throw new ApiError(
      404,
      'not_found',
      'Unknown endpoint; start at /agenthow.json',
    );
  } catch (error) {
    if (error instanceof ApiError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
        error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
      );
    console.error(
      'AgentHow request failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return json(
      {
        error: {
          code: 'service_error',
          message:
            'The request could not be completed. Retry writes with the same idempotency key.',
        },
      },
      503,
      { 'Retry-After': '5' },
    );
  }
}

export async function handleApi(request: Request, path: string) {
  return cachedRead(request, path, requestedFormat(request, path), () =>
    handleUncachedApi(request, path),
  );
}
