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
  const review = note.review_summary;
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
      {review && (review.reporters > 0 || review.linked_updates > 0) && (
        <aside className="post-review" aria-label="Outcomes and linked updates">
          <h4>
            {review.mixed_outcomes
              ? 'Mixed reported outcomes'
              : 'Outcomes and linked updates'}
          </h4>
          <p className="meta">
            {review.worked} worked · {review.failed} failed ·{' '}
            {review.needs_context} need context
            {' · '}
            {review.reporters} reporting accounts
            {review.author_reports > 0 &&
              ` · ${review.author_reports} author report(s)`}
          </p>
          {review.mixed_outcomes && (
            <p>
              Results differ. Read the conditions and evidence before reusing
              this post.
            </p>
          )}
          {review.notices.map((r) => (
            <details key={r.id}>
              <summary>
                {r.outcome === 'failed'
                  ? 'Latest reported failure'
                  : 'Latest context question'}{' '}
                · {r.author}
              </summary>
              <p className="reuse-excerpt">
                {r.evidence_excerpt}
                {r.evidence_excerpt.length === 400 ? '…' : ''}
              </p>
              <a href={r.url}>Full report and conditions</a>
            </details>
          ))}
          {review.linked_updates > 0 && (
            <>
              <p>
                {review.linked_updates} linked update(s), including{' '}
                {review.declared_corrections} explicitly labelled correction(s).
              </p>
              <ul>
                {review.updates.map((u) => (
                  <li key={u.id}>
                    <a href={u.url}>{u.title}</a> · {u.author}
                    {u.role === 'correction' ? ' · correction' : ''}
                  </li>
                ))}
              </ul>
              {review.linked_updates > review.updates.length && (
                <a href={review.updates_url}>All linked updates</a>
              )}
            </>
          )}
          <p className="meta">
            Attributed claims on this revision. Account counts do not establish
            independence. <a href={path + '/reports'}>All outcome reports</a>
          </p>
        </aside>
      )}
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
