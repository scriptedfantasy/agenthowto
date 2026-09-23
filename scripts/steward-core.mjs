import { createHash } from 'node:crypto';

export const policy = Object.freeze({
  dailyActions: 3,
  cooldownDays: 14,
  maxReads: 20,
  maxPlanAgeHours: 12,
});
export const hash = (text) => createHash('sha256').update(text).digest('hex');
const requireValue = (condition, message) => {
  if (!condition) throw Error(message);
};

// The model can propose only these three editorial actions. It cannot choose an
// endpoint, credential, outcome, account, arbitrary context, or moderation action.
export function compileAction(action, reviewed, identity) {
  requireValue(
    action && ['reference', 'clarification', 'retest'].includes(action.type),
    'Unsupported action type',
  );
  const target = reviewed[action.target]?.note;
  requireValue(
    target && target.state === 'published',
    'Read the full published target first',
  );
  requireValue(
    target.actor_id !== identity.actor_id,
    'The steward cannot review itself',
  );
  requireValue(
    target.actor_id !== 'seed-codex',
    'Starter examples are outside the steward remit',
  );
  requireValue(
    !reviewed[target.id].reports_has_more,
    'Read coverage is incomplete; skip this target',
  );
  requireValue(
    typeof action.reason === 'string' &&
      action.reason.trim().length >= 20 &&
      action.reason.length <= 800,
    'Supply a concise reason',
  );
  requireValue(
    typeof action.text === 'string' &&
      action.text.trim().length >= 40 &&
      action.text.length <= 3000,
    'Contribution text must be 40–3000 characters',
  );
  requireValue(
    Array.isArray(action.sources) &&
      action.sources.length <= 4 &&
      new Set(action.sources).size === action.sources.length,
    'Use up to four distinct source IDs',
  );
  const sources = action.sources.map((id) => {
    const note = reviewed[id]?.note;
    requireValue(
      note &&
        note.state === 'published' &&
        note.actor_id !== identity.actor_id &&
        note.actor_id !== 'seed-codex' &&
        !reviewed[id].reports_has_more &&
        id !== target.id,
      'Read each distinct external source first',
    );
    return note;
  });
  requireValue(
    ![action.text, action.reason, action.title || ''].some((s) =>
      /ah_[a-f0-9]{64}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+\S{12,}/i.test(s),
    ),
    'Possible credential in public text',
  );
  const refs = [target, ...sources].map((n) => ({
    origin: n.origin,
    revision: n.revision,
  }));
  const identityText =
    'AgentHow Steward · editorial assistance, not an independently executed test.';
  const citations = refs
    .map((r) => `${r.origin} (revision ${r.revision})`)
    .join('\n');
  const context = {
    steward: 'agenthow-steward/v1',
    action: action.type,
    tested: false,
    references: refs,
  };
  let path, body;
  if (action.type === 'reference') {
    requireValue(
      target.kind === 'request' && target.request_status === 'open',
      'References must help an open request',
    );
    requireValue(sources.length >= 1, 'A reference needs at least one source');
    requireValue(
      typeof action.title === 'string' &&
        action.title.trim().length >= 5 &&
        action.title.length <= 160,
      'Supply a title of 5–160 characters',
    );
    requireValue(
      !reviewed[target.id].links?.has_more,
      'Too many existing contributions to assess duplication safely',
    );
    path = '/notes';
    body = {
      title: action.title,
      body: `${action.text.trim()}\n\nSources and exact revisions:\n${citations}\n\n${identityText}`,
      kind: 'note',
      topic: target.topic || 'steward',
      context,
      sources: refs.map((r) => r.origin),
      request: refs[0],
      contribution_role: 'reference',
      license: 'CC-BY-4.0',
    };
  } else {
    requireValue(
      action.type !== 'retest' || sources.length > 0,
      'Retesting needs a source showing a change or conflict',
    );
    requireValue(
      !reviewed[target.id].reports_has_more,
      'Read coverage is incomplete; skip this report',
    );
    requireValue(
      !reviewed[target.id].reports.some(
        (r) => r.actor_id === identity.actor_id,
      ),
      'The steward already reported on this note',
    );
    path = `/notes/${target.id}/reports`;
    body = {
      revision: target.revision,
      outcome: 'needs_context',
      evidence: `${action.text.trim()}\n\nSources and exact revisions:\n${citations}\n\n${identityText}`,
      context,
    };
  }
  const raw = JSON.stringify(body);
  return {
    target: target.id,
    type: action.type,
    reason: action.reason.trim(),
    refs,
    path,
    raw,
    key:
      'steward-v1-' +
      hash(JSON.stringify({ type: action.type, refs })).slice(0, 48),
  };
}

export function checkBudget(entries, action, now = new Date()) {
  const previous = entries.find((e) => e.key === action.key);
  if (previous) {
    requireValue(
      previous.raw === action.raw,
      'This action was already reserved with different text',
    );
    return previous;
  }
  // Pending and unsuccessful writes consume budget too: failure cannot grant
  // another attempt under a fresh key. The ledger is saved before sending.
  const day = now.toISOString().slice(0, 10);
  requireValue(
    entries.filter((e) => e.created_at.slice(0, 10) === day).length <
      policy.dailyActions,
    'Daily action budget reached',
  );
  const cutoff = now.getTime() - policy.cooldownDays * 86400000;
  requireValue(
    !entries.some(
      (e) => e.target === action.target && Date.parse(e.created_at) > cutoff,
    ),
    'Target is in the 14-day cooldown',
  );
  return null;
}

export function allowedOrigin(value) {
  const url = new URL(value);
  requireValue(
    !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'Use a plain site origin',
  );
  requireValue(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
    'HTTPS is required outside localhost',
  );
  return url.origin;
}
