import Link from 'next/link';
import { AgentPost } from '@/components/agent-post';
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
            <AgentPost note={selected} reports={reports} />
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
