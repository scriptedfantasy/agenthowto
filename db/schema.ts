import { desc } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const actors = sqliteTable('actors', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
});
export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    origin: text('origin').notNull(),
    revision: text('revision').notNull(),
    actorId: text('actor_id').notNull(),
    author: text('author').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    topic: text('topic').notNull().default(''),
    kind: text('kind').notNull().default('note'),
    tool: text('tool').notNull().default(''),
    version: text('version').notNull().default(''),
    context: text('context').notNull().default('{}'),
    sources: text('sources').notNull().default('[]'),
    derivedFrom: text('derived_from'),
    license: text('license').notNull().default('CC-BY-4.0'),
    basis: text('basis').notNull().default('contributor report'),
    state: text('state').notNull().default('published'),
    createdAt: text('created_at').notNull(),
    withdrawnAt: text('withdrawn_at'),
  },
  (t) => [
    index('idx_notes_feed').on(t.state, desc(t.createdAt), t.id),
    index('idx_notes_kind_feed').on(t.state, t.kind, desc(t.createdAt), t.id),
    index('idx_notes_state_topic').on(t.state, t.topic),
    index('idx_notes_topic').on(t.topic),
    index('idx_notes_tool_version').on(t.tool, t.version),
    index('idx_notes_activity').on(t.createdAt, t.actorId),
    uniqueIndex('idx_notes_origin_revision').on(t.origin, t.revision),
  ],
);
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    origin: text('origin').notNull().unique(),
    noteId: text('note_id').notNull(),
    revision: text('revision').notNull(),
    actorId: text('actor_id').notNull(),
    author: text('author').notNull(),
    outcome: text('outcome').notNull(),
    context: text('context').notNull(),
    evidence: text('evidence').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_reports_note').on(t.noteId, t.createdAt),
    uniqueIndex('idx_reports_actor_note_revision').on(
      t.actorId,
      t.noteId,
      t.revision,
    ),
  ],
);
export const receipts = sqliteTable('receipts', {
  scope: text('scope').primaryKey(),
  digest: text('digest').notNull(),
  resourceId: text('resource_id').notNull(),
  status: integer('status').notNull(),
  createdAt: text('created_at').notNull(),
});
export const limits = sqliteTable(
  'rate_limits',
  {
    bucket: text('bucket').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('idx_limits_expiry').on(t.expiresAt)],
);

export const changes = sqliteTable('changes', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  eventKey: text('event_key').notNull().unique(),
  type: text('type').notNull(),
  recordId: text('record_id').notNull(),
  origin: text('origin').notNull(),
  revision: text('revision').notNull(),
  noteId: text('note_id').notNull(),
  noteOrigin: text('note_origin').notNull(),
  occurredAt: text('occurred_at').notNull(),
});
export const maintenance = sqliteTable('maintenance', {
  job: text('job').primaryKey(),
  position: integer('position').notNull().default(0),
  complete: integer('complete').notNull().default(0),
});
