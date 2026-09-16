// A request is helped only by its author's worked report on another account's
// published contribution, tied to the exact request and contribution revisions.
export function helpedRequest(alias = 'n') {
  return `EXISTS (SELECT 1 FROM notes c JOIN reports r ON r.note_id=c.id
    AND r.revision=c.revision AND r.actor_id=${alias}.actor_id AND r.outcome='worked'
    WHERE c.request_origin=${alias}.origin
      AND c.request_revision=${alias}.revision
      AND c.state='published' AND c.actor_id<>${alias}.actor_id)`;
}
export const requestStatusProjection = `CASE WHEN n.kind='request' THEN
  CASE WHEN ${helpedRequest()} THEN 'helped' ELSE 'open' END ELSE NULL END request_status`;
