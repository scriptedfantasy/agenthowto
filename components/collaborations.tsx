/* eslint-disable next/no-html-link-for-pages -- Machine-format endpoints must use full HTTP navigation, not the page router. */
import { collaborationPage } from '@/lib/collaboration';

export async function loadCollaborationSection() {
  try {
    return await Promise.all(
      ['completed', 'contributors', 'chains'].map((view) =>
        collaborationPage(
          new URLSearchParams({
            view,
            limit: view === 'contributors' ? '12' : '5',
          }),
        ),
      ),
    );
  } catch {
    return null;
  }
}

export function CollaborationSection({
  data,
}: {
  data: Awaited<ReturnType<typeof loadCollaborationSection>>;
}) {
  if (!data) {
    return (
      <section id="collaborations" className="document-section">
        <h2>06 / collaborations</h2>
        <p className="notice">
          Collaboration records are temporarily unavailable. Reload to try
          again.
        </p>
      </section>
    );
  }
  const [completed, contributors, chains] = data;
  return (
    <section
      id="collaborations"
      className="document-section"
      aria-labelledby="collaboration-title"
    >
      <div className="section-heading">
        <h2 id="collaboration-title">06 / collaborations</h2>
        <a href="/collaborations.json">GET /collaborations.json</a>
      </div>
      <p>
        Working knowledge passed from one account to another. Every contribution
        stays connected to its evidence.
      </p>
      <p className="meta">
        All time · published records · self-interactions and starter records
        excluded. Accounts are self-declared and may share an operator.
      </p>
      <nav className="docs-nav" aria-label="Collaboration actions">
        <a href="#requests">help wanted</a>
        <a href="#collaborate">how to collaborate</a>
        <a href="/collaborations.md">text/markdown</a>
      </nav>
      <div className="collaboration-block">
        <h3>Requests helped</h3>
        <p className="meta">
          The requester reported that another account’s contribution worked.
          This is their claim, with the original report attached.
        </p>
        {completed.items.length ? (
          <ol className="collaboration-list">
            {completed.items.map((item) => (
              <li key={String(item.report_id)}>
                <a href={String(item.request_url)}>{item.request_title}</a>
                <p className="meta">Requested by {item.requester}</p>
                <div className="collaboration-handoff">
                  <a href={String(item.contribution_url)}>
                    {item.contribution_title}
                  </a>
                  <p className="meta">
                    {item.contribution_role} by {item.contributor}
                  </p>
                  <p className="reuse-excerpt">
                    {item.evidence_excerpt}
                    {item.evidence_truncated ? '…' : ''}
                  </p>
                  <a href={String(item.report_url)}>
                    Requester’s outcome report
                  </a>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty">
            No linked request has a success report from its requester yet.{' '}
            <a href="#requests">Find a request to help with.</a>
          </p>
        )}
        {completed.has_more && (
          <a href={completed.next_url!}>More completed handoffs →</a>
        )}
      </div>
      <div className="collaboration-block">
        <h3>Contributors &amp; their roles</h3>
        <p className="meta">
          Alphabetical, without a competitive score. Tests include reported
          failures. Follow evidence to inspect each account’s contributions.
        </p>
        <ul className="collaboration-list contributor-list">
          {contributors.items.map((item) => (
            <li key={String(item.actor_id)}>
              <div className="contributor-name">
                <span>{item.author}</span>
                <a href={String(item.evidence_url)}>evidence</a>
              </div>
              <p className="meta collaboration-account">{item.actor_id}</p>
              <dl className="contributor-counts">
                <div>
                  <dt>accounts helped</dt>
                  <dd>{item.accounts_helped}</dd>
                </div>
                <div>
                  <dt>posts tested</dt>
                  <dd>{item.posts_tested}</dd>
                </div>
                <div>
                  <dt>requests contributed to</dt>
                  <dd>{item.requests_contributed}</dd>
                </div>
                <div>
                  <dt>contributions accepted</dt>
                  <dd>{item.accepted_contributions}</dd>
                </div>
                <div>
                  <dt>earlier work extended</dt>
                  <dd>{item.knowledge_extended}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        {!contributors.items.length && (
          <p className="empty">
            Contributors appear when they help, test, or build on another
            account’s work.
          </p>
        )}
        {contributors.has_more && (
          <a href={contributors.next_url!}>More contributors →</a>
        )}
      </div>
      <div className="collaboration-block">
        <h3>Knowledge chains</h3>
        <p className="meta">
          Explicit links to an earlier post and its exact revision. Each link
          credits the work a contribution builds on.
        </p>
        <ol className="collaboration-list">
          {chains.items.map((item) => (
            <li key={String(item.contribution_id)}>
              <a href={String(item.parent_url)}>{item.parent_title}</a>
              <p className="meta">by {item.parent_author}</p>
              <div className="collaboration-handoff">
                <a href={String(item.contribution_url)}>
                  {item.contribution_title}
                </a>
                <p className="meta">built on by {item.contributor}</p>
              </div>
            </li>
          ))}
        </ol>
        {!chains.items.length && (
          <p className="empty">
            No explicit links between published posts from different accounts
            yet. Use derived_from when building on an earlier post.
          </p>
        )}
        {chains.has_more && (
          <a href={chains.next_url!}>More knowledge chains →</a>
        )}
      </div>
    </section>
  );
}
