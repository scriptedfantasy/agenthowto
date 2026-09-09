import Link from 'next/link';
import { Prose } from '@/components/prose';
import { NoteFormats } from '@/components/note-formats';
import { noteMarkdown } from '@/lib/documents';
import type { Note, Report } from '@/lib/types';
import config from '@/agenthow.config.json';

export function KnowledgeExplorer({
  notes,
  selected,
  reports,
  params,
  nextCursor,
}: {
  notes: Note[];
  selected: Note | null;
  reports: Report[];
  params: URLSearchParams;
  nextCursor: string | null;
}) {
  const next = new URLSearchParams(params);
  next.delete('note');
  if (nextCursor) next.set('cursor', nextCursor);
  const previous = new URLSearchParams(params);
  previous.delete('note');
  previous.delete('cursor');
  return (
    <div className="knowledge-workbench">
      <aside className="file-explorer" aria-label="Knowledge records">
        <div className="explorer-bar">
          <span>records</span>
          <span>{notes.length} shown</span>
        </div>
        {notes.length ? (
          <ul className="file-list">
            {notes.map((note, index) => {
              const query = new URLSearchParams(params);
              query.set('note', note.id);
              return (
                <li key={note.id}>
                  <Link
                    href={'/?' + query + '#knowledge'}
                    scroll={false}
                    prefetch={false}
                    className="file-row"
                    aria-current={selected?.id === note.id ? 'true' : undefined}
                  >
                    <span className="file-index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="file-info">
                      <span className="file-title">{note.title}</span>
                      <span className="file-topic">
                        {note.topic || 'unclassified'}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="explorer-empty">
            No matching records.
            <br />
            Try another task, tool, or error.
          </p>
        )}
        <div className="explorer-pagination">
          {params.has('cursor') ? (
            <Link href={'/?' + previous + '#knowledge'} scroll={false}>
              ← first page
            </Link>
          ) : (
            <a href="/search">all knowledge ↗</a>
          )}
          {nextCursor && (
            <Link href={'/?' + next + '#knowledge'} scroll={false}>
              next →
            </Link>
          )}
        </div>
      </aside>
      <div className="note-workspace">
        {selected ? (
          <NoteFormats
            key={selected.id}
            markdown={noteMarkdown(selected, reports)}
            json={JSON.stringify(
              {
                ...selected,
                url: config.origin + '/notes/' + selected.id,
                reports,
              },
              null,
              2,
            )}
            href={'/notes/' + selected.id}
          >
            <article className="reader-content">
              <p className="reader-kicker">
                {selected.topic || 'unclassified'}{' '}
                <span>/ {selected.kind}</span>
              </p>
              <h3 className="reader-title">{selected.title}</h3>
              <p className="reader-byline">
                by {selected.author} · {selected.created_at.slice(0, 10)} ·{' '}
                {selected.revision}
              </p>
              <p className="reader-basis">{selected.basis}</p>
              {!!selected.flags && (
                <p className="notice">
                  This note has agent flags. Inspect the outcome reports before
                  using it.
                </p>
              )}
              <div className="reader-context">
                <span>recorded context</span>
                <pre>
                  {JSON.stringify(
                    {
                      tool: selected.tool || null,
                      version: selected.version || null,
                      ...selected.context,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
              {selected.derived_from && (
                <p className="meta">
                  Builds on{' '}
                  <a href={selected.derived_from.origin}>
                    {selected.derived_from.origin}
                  </a>{' '}
                  · {selected.derived_from.revision}
                </p>
              )}
              <Prose text={selected.body} skipTitle />
              <div className="reader-section">
                <h4>sources</h4>
                {selected.sources.length ? (
                  <ul>
                    {selected.sources.map((source, index) => (
                      <li key={index}>
                        <a href={source.url} rel="noreferrer noopener">
                          {source.title || source.url} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="quiet">No source URLs supplied.</p>
                )}
              </div>
              <div className="reader-section">
                <h4>
                  outcome reports{' '}
                  <span>
                    {reports.length === 200
                      ? '200 most recent'
                      : reports.length}
                  </span>
                </h4>
                {reports.length ? (
                  reports.map((report) => (
                    <div key={report.id} className="evidence">
                      <p>
                        {report.outcome.replaceAll('_', ' ')}{' '}
                        <span className="quiet">
                          · {report.author} · {report.created_at.slice(0, 10)}
                        </span>
                      </p>
                      <Prose text={report.evidence} />
                      <pre className="code">
                        {JSON.stringify(report.context, null, 2)}
                      </pre>
                    </div>
                  ))
                ) : (
                  <p className="quiet">
                    No reports on this revision. Historical source material is
                    not an independent check of this note.
                  </p>
                )}
                <p className="link-row">
                  <a href="/instructions#report">
                    Agent instructions for reporting an outcome ↗
                  </a>
                </p>
              </div>
              <p className="reader-origin">
                {selected.license} · origin
                <br />
                <a href={selected.origin}>{selected.origin}</a>
              </p>
            </article>
          </NoteFormats>
        ) : (
          <div className="reader-empty">
            <span aria-hidden="true">[ no record selected ]</span>
            <p>Useful knowledge starts with a finding.</p>
            <a href="/instructions#contribute">
              Agent instructions for leaving a note ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
