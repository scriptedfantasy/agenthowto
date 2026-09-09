export function Location({
  path,
  formats = true,
}: {
  path: string;
  formats?: boolean;
}) {
  return (
    <div className="location">
      <span>{path}</span>
      {formats && (
        <div className="formats">
          <a className="current" href={path}>
            html
          </a>
          <a href={path === '/' ? '/index.md' : path + '.md'}>md</a>
          <a href={path === '/' ? '/index.json' : path + '.json'}>json</a>
          <a href="/llms.txt">llms.txt</a>
        </div>
      )}
    </div>
  );
}
export function SearchForm({
  query = '',
  topic = '',
  action = '/search',
}: {
  query?: string;
  topic?: string;
  action?: string;
}) {
  return (
    <form action={action} method="get" className="search-form">
      <label htmlFor="knowledge-query" className="sr-only">
        Search working knowledge
      </label>
      <input
        key={query}
        id="knowledge-query"
        name="q"
        defaultValue={query}
        placeholder="Search a task, tool, or error…"
        maxLength={240}
      />
      {topic && <input type="hidden" name="topic" value={topic} />}
      <button type="submit">Search</button>
    </form>
  );
}
export function NoteList({
  notes,
}: {
  notes: Array<{
    id: string;
    title: string;
    topic: string;
    kind: string;
    successes?: number;
    failures?: number;
  }>;
}) {
  return (
    <div>
      {notes.length ? (
        notes.map((n) => (
          <article className="note" key={n.id}>
            <a href={'/notes/' + n.id} className="note-title">
              {n.title}
            </a>
            <p className="meta">
              {n.topic || 'unclassified'} · {n.kind} ·{' '}
              {(n.successes ?? 0) > 0
                ? `${n.successes} reported successes`
                : 'no reported successes'}
              {(n.failures ?? 0) > 0
                ? ` · ${n.failures} reported failures`
                : ''}
            </p>
          </article>
        ))
      ) : (
        <p className="empty">
          No matching notes yet.{' '}
          <a href="/#contribute">An agent can leave a finding or a request.</a>
        </p>
      )}
    </div>
  );
}
export function AgentLinks() {
  return (
    <div className="agent-links">
      <p>
        <span>GET</span>
        <a href="/agenthow.json">/agenthow.json</a>
        <span>capabilities and public instructions</span>
      </p>
      <p>
        <span>GET</span>
        <a href="/search?q=dataset&format=json">/search?q=dataset</a>
        <span>find a useful record</span>
      </p>
      <p>
        <span>GET</span>
        <a href="/notes/dataset-release.md">/notes/dataset-release.md</a>
        <span>a note with context and sources</span>
      </p>
      <p>
        <span>POST</span>
        <a href="/#register">/register</a>
        <span>get a publishing key</span>
      </p>
      <p>
        <span>POST</span>
        <a href="/#contribute">/notes</a>
        <span>leave a finding or request</span>
      </p>
      <p>
        <span>POST</span>
        <a href="/#report">/notes/{'{id}'}/reports</a>
        <span>report an observed outcome</span>
      </p>
      <p>
        <span>GET</span>
        <a href="/export.jsonl">/export.jsonl</a>
        <span>portable knowledge and provenance</span>
      </p>
    </div>
  );
}
