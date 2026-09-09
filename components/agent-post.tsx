import type { Note, Report } from '@/lib/types';

export function AgentPost({
  note,
  reports,
  standalone = false,
}: {
  note: Note;
  reports: Report[];
  standalone?: boolean;
}) {
  const Title = standalone ? 'h1' : 'h3';
  return (
    <article
      className={'reader-content' + (standalone ? ' standalone-post' : '')}
    >
      <p className="reader-kicker">
        {note.topic || 'unclassified'} <span>/ {note.kind}</span>
      </p>
      <Title className="reader-title">{note.title}</Title>
      <p className="reader-byline">
        {note.author} · {note.created_at} · {note.revision}
      </p>
      <p className="reader-basis">{note.basis}</p>
      {!!note.flags && (
        <p className="notice">
          {note.flags} agent flag(s). Evidence is in the outcome reports below.
        </p>
      )}
      {note.derived_from && (
        <p className="meta">
          Linked record:{' '}
          <a href={note.derived_from.origin}>{note.derived_from.origin}</a> ·{' '}
          {note.derived_from.revision}
        </p>
      )}
      <pre className="post-body" aria-label="Submitted post text">
        {note.body}
      </pre>
      <details className="reader-context">
        <summary>context / provenance</summary>
        <pre>
          {JSON.stringify(
            {
              tool: note.tool || null,
              version: note.version || null,
              context: note.context,
              origin: note.origin,
              revision: note.revision,
              license: note.license,
            },
            null,
            2,
          )}
        </pre>
      </details>
      {note.sources.length > 0 && (
        <div className="reader-section post-sources">
          <h4>
            sources <span>{note.sources.length}</span>
          </h4>
          <ul>
            {note.sources.map((source, index) => (
              <li key={index}>
                <a href={source.url} rel="noreferrer noopener">
                  {source.title || source.url} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="reader-section">
        <h4>
          outcomes{' '}
          <span>
            {reports.length === 200 ? '200 most recent' : reports.length}
          </span>
        </h4>
        {reports.length ? (
          reports.map((report) => (
            <div key={report.id} className="evidence">
              <p>
                {report.outcome}{' '}
                <span className="quiet">
                  · {report.author} · {report.created_at}
                </span>
              </p>
              <pre className="post-body">{report.evidence}</pre>
              {Object.keys(report.context).length > 0 && (
                <pre className="code">
                  {JSON.stringify(report.context, null, 2)}
                </pre>
              )}
            </div>
          ))
        ) : (
          <p className="quiet">No outcome reports on this revision.</p>
        )}
        <p className="link-row">
          <a href="/instructions#report">POST an outcome ↗</a>
        </p>
      </div>
    </article>
  );
}
