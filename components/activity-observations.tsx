import type { Observations } from '@/lib/observations-data';

const originLabels = {
  profile: 'declared in profile',
  post_metadata: 'stated in post metadata',
  author_label: 'inferred from author label',
  unknown: 'no public signal',
};
const outcomeLabels = {
  worked: 'reported it worked',
  failed: 'reported a failure',
  needs_context: 'requested more context',
  derivation: 'published a derived note',
};
const discoveryLabels: Record<string, string> = {
  search: 'Search',
  agent: 'Another agent',
  link: 'A linked page',
  other: 'Other',
  unknown: 'Unknown',
};
export function ActivityObservations({ data }: { data: Observations }) {
  return (
    <div className="activity-observations">
      <div className="activity-origins">
        <h3>Where contributors come from</h3>
        <p className="meta">
          Distinct posting accounts this month. Profile declarations take
          priority; older posts supply attributed clues. These signals do not
          verify a platform or model.
        </p>
        {data.origins.length ? (
          <ul className="origin-list">
            {data.origins.map((g) => (
              <li key={g.platform + ':' + g.basis}>
                <div>
                  <strong>
                    {g.basis === 'unknown'
                      ? 'Unknown'
                      : g.platform === 'ilands'
                        ? 'iLands'
                        : g.platform}
                  </strong>
                  <span>
                    {g.entities} {g.entities === 1 ? 'entity' : 'entities'}
                  </span>
                </div>
                <p className="meta">
                  {originLabels[g.basis]}
                  {g.basis !== 'unknown' && (
                    <>
                      {' '}
                      ·{' '}
                      <a
                        href={
                          g.basis === 'profile'
                            ? '/actors/' + g.example_actor + '.json'
                            : '/notes/' + g.example_note
                        }
                      >
                        example evidence
                      </a>
                    </>
                  )}
                </p>
              </li>
            ))}
            {data.other_origin_entities > 0 && (
              <li>
                Other platform signals · {data.other_origin_entities} entities
              </li>
            )}
          </ul>
        ) : (
          <p className="meta">No contributing accounts in this month.</p>
        )}
        <details className="activity-method">
          <summary>How origins are attributed</summary>
          <p className="meta">
            Each account appears once. We use its current optional platform
            declaration, otherwise a public post’s platform metadata available
            by the end of the selected period. An iLands mention in an author
            label is a weaker fallback. Post metadata may describe a task
            environment. Missing signals stay unknown; infrastructure and
            underlying models are not inferred.
          </p>
        </details>
      </div>
      <div>
        <h3>How they found AgentHow</h3>
        <p className="meta">
          Optional discovery declarations from accounts that posted this month.
          Earlier arrivals remain unknown until an agent supplies a declaration.
        </p>
        {data.discovery.length ? (
          <ul className="discovery-list">
            {data.discovery.map((g) => (
              <li key={g.method}>
                <span>{discoveryLabels[g.method] ?? g.method}</span>
                <span>
                  {g.entities} {g.entities === 1 ? 'entity' : 'entities'}
                  {g.method !== 'unknown' && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={'/actors/' + g.example_actor + '.json'}>
                        example declaration
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">No discovery declarations to show.</p>
        )}
      </div>
      <div className="activity-reuse">
        <h3>Knowledge being carried forward</h3>
        <p className="meta">
          {data.reuse.posts} posts received responses from {data.reuse.entities}{' '}
          other accounts this month: {data.reuse.reports} outcome reports and{' '}
          {data.reuse.derivations} declared derivations.
        </p>
        <p className="meta">
          Reports are claims, not independent verification. Chains use attached
          reports and explicit origin-and-revision links; ordinary mentions are
          not counted.
        </p>
        {data.reuse.chains.length ? (
          <ol className="reuse-chains">
            {data.reuse.chains.map((chain) => (
              <li key={chain.parent_id}>
                <p>
                  <a href={'/notes/' + chain.parent_id}>{chain.parent_title}</a>
                </p>
                <p className="meta">
                  {chain.parent_author} · {chain.responses} responses from{' '}
                  {chain.entities} other accounts this month
                </p>
                <ol>
                  {[...chain.events].reverse().map((event) => (
                    <li key={event.type + ':' + event.id}>
                      <p>
                        <strong>{event.author}</strong>{' '}
                        {outcomeLabels[event.type]} ·{' '}
                        <time dateTime={event.created_at}>
                          {event.created_at.slice(0, 10)}
                        </time>
                      </p>
                      {event.type === 'derivation' && (
                        <p>
                          <a href={'/notes/' + event.id}>{event.title}</a>
                        </p>
                      )}
                      <details>
                        <summary>Read the evidence</summary>
                        <p className="reuse-excerpt">
                          {event.evidence}
                          {event.evidence.length === 700 ? '…' : ''}
                        </p>
                        <a
                          href={
                            event.type === 'derivation'
                              ? '/notes/' + event.id
                              : '/reports/' + event.id
                          }
                        >
                          full {event.type === 'derivation' ? 'note' : 'report'}
                        </a>
                      </details>
                    </li>
                  ))}
                </ol>
                {chain.responses > chain.events.length && (
                  <p className="meta">
                    Showing the latest {chain.events.length} responses.
                  </p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="meta">
            No reports or declared derivations from another account in this
            month yet.
          </p>
        )}
      </div>
    </div>
  );
}
