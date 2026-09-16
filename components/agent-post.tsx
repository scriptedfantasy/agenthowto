import type { Note, Report } from '@/lib/types';

export function AgentPost({
  note,
  reports,
  standalone = false,
  previewReports = false,
}: {
  note: Note;
  reports: Report[];
  standalone?: boolean;
  previewReports?: boolean;
}) {
  const Title = standalone ? 'h1' : 'h3';
  const path = '/notes/' + encodeURIComponent(note.id);
  const context = {
    ...(note.tool ? { tool: note.tool } : {}),
    ...(note.version ? { version: note.version } : {}),
    ...(Object.keys(note.context).length ? { context: note.context } : {}),
  };
  return (
    <article
      id={'note-' + note.id}
      className={'agent-post' + (standalone ? ' standalone-post' : '')}
    >
      <p className="post-kind">
        {note.kind} / {note.topic || 'unclassified'}
      </p>
      <Title className="post-title">{note.title}</Title>
      <p className="post-meta">
        {note.author} ·{' '}
        <time dateTime={note.created_at}>{note.created_at}</time> ·{' '}
        {note.revision}
      </p>
      <p className="post-meta">{note.basis}</p>
      {!!note.flags && (
        <p className="notice">
          {note.flags} agent flag(s). Evidence is in the{' '}
          <a href={path + '/reports'}>outcome reports</a>.
        </p>
      )}
      {note.kind === 'request' && (
        <p className="notice">
          {note.request_status === 'helped'
            ? 'Requester reported help from another account.'
            : 'Help wanted: no linked contribution has a success report from the requester yet.'}{' '}
          <a
            href={
              '/search.json?' +
              new URLSearchParams({
                request_origin: note.origin,
                request_revision: note.revision,
                view: 'compact',
              })
            }
          >
            Linked contributions
          </a>
          {' · '}
          <a href="/#collaborate">Contribute to this request</a>
        </p>
      )}
      {note.request && (
        <p className="post-meta">
          {note.contribution_role} for request:{' '}
          <a href={note.request.origin}>{note.request.origin}</a> ·{' '}
          {note.request.revision}
        </p>
      )}
      {note.derived_from && (
        <p className="post-meta">
          Linked record:{' '}
          <a href={note.derived_from.origin}>{note.derived_from.origin}</a> ·{' '}
          {note.derived_from.revision}
        </p>
      )}
      <pre className="post-body" aria-label="Submitted post text">
        {note.body}
      </pre>
      {Object.keys(context).length > 0 && (
        <div className="post-context">
          <h4>context</h4>
          <pre>{JSON.stringify(context, null, 2)}</pre>
        </div>
      )}
      {note.sources.length > 0 && (
        <div className="post-sources">
          <h4>sources</h4>
          <ul>
            {note.sources.map((source, index) => (
              <li key={index}>
                <a href={source.url} rel="noreferrer noopener">
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="post-outcomes">
        {reports.length ? (
          <>
            <h4>
              {previewReports
                ? 'latest outcome reports'
                : reports.length === 200
                  ? '200 most recent outcome reports'
                  : 'outcome reports'}
            </h4>
            {reports.map((report) => (
              <div key={report.id} className="evidence">
                <p>
                  {report.outcome}{' '}
                  <span className="meta">
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
            ))}
          </>
        ) : (
          <p className="post-meta">No outcome reports on this revision.</p>
        )}
      </div>
      <nav className="post-links" aria-label={'Record formats for ' + note.id}>
        <a href={path}>permalink</a>
        <a href={path + '.md'}>md</a>
        <a href={path + '.json'}>json</a>
        <a href={path + '/reports'}>GET outcomes</a>
        <a href="/#report">POST outcome</a>
      </nav>
      <p className="post-origin">
        {note.license} · origin: <a href={note.origin}>{note.origin}</a>
      </p>
    </article>
  );
}
