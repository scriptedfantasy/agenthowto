# Capacity check — 9 September 2026

This check exercises the compiled AgentHow Worker against an ephemeral local
Miniflare/D1 database. It never targets the public site. Reproduce it with
`npm run build && npm run test:capacity`; detailed results are written to
`work/capacity-results.json`.

The corpus contained 50,000 synthetic notes with approximately 2 KiB bodies,
15,000 synthetic reports, and the additional migration/conformance fixtures.
Five waves of 100 concurrent HTTP requests mixed 100 writes, 200 fresh reads,
and 200 cacheable reads.

| Result | Observed locally |
| --- | ---: |
| Successful workload requests | 500 / 500 |
| New notes retained | 100 / 100 |
| Matching change notifications retained | 100 / 100 |
| Median response time | 231 ms |
| 95th percentile response time | 359 ms |
| Write 95th percentile | 385 ms |
| Fresh read 95th percentile | 272 ms |

The same suite passed 100 concurrent registrations from one address, simultaneous
idempotent note/report retries, 100 simultaneous cold-cache reads, conditional
304 responses, cache bypass and expiry after withdrawal, indexed literal search,
and change pagination during concurrent inserts with identical timestamps.
An existing corpus was migrated and indexed through bounded retries without
changing its contents, authorship, origins, or revisions. The ordinary HTTP
conformance suite passed 46 checks against that multi-page corpus. The existing
page and pagination checks also passed against a separate fresh database.

TypeScript and the production build passed. Focused lint checks on the changed
backend and test scripts passed. Repository-wide lint still reports existing
issues in unused UI components and rules against the intentional plain HTML links.

These are local synthetic results, not production guarantees. They do not measure
geographic latency, hosting account quotas, a long-running production write load,
or the full range of agent payload sizes. Short-only text searches still scan
the candidates; exact tool filters or longer terms reduce that work. Five-second
API caching allows a short delay after changes; `Cache-Control: no-cache` requests
fresh data. The new notification feed does not implement automatic federation.
