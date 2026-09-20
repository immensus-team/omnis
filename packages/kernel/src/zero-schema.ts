// Single source of truth for replication scope. Must match the A3 §7 publication
// (0008_publication.sql) — assertZeroPublication checks that match on every boot.
import {
  type ExpressionBuilder,
  type Schema,
  boolean,
  createSchema,
  definePermissions,
  json,
  number,
  relationships,
  string,
  table,
} from "@rocicorp/zero";

const accounts = table("accounts")
  .columns({
    id: string(),
    channel: string(),
    external_id: string(),
    display: string(),
    capabilities: json(),
    state: string(),
    last_health_at: number().optional(),
    last_error: string().optional(),
    created_at: number(),
  })
  .primaryKey("id");

const threads = table("threads")
  .columns({
    id: string(),
    account_id: string(),
    external_id: string(),
    kind: string(),
    title: string().optional(),
    scope: string(),
    participants: json<string[]>(),
    meta: json(),
    last_item_at: number().optional(),
    unread_count: number(),
    needs_action: boolean(),
    archived_at: number().optional(),
    muted_until: number().optional(),
    created_at: number(),
  })
  .primaryKey("id");

// A3 §7: embedding (768d × 4B) and the generated column search_tsv do not travel to the phone.
const items = table("items")
  .columns({
    id: string(),
    thread_id: string(),
    account_id: string(),
    external_id: string().optional(),
    kind: string(),
    status: string(),
    scope: string(),
    sensitivity: string(),
    author_person_id: string().optional(),
    author_agent_id: string().optional(),
    author_is_me: boolean(),
    in_reply_to: string().optional(),
    subject: string().optional(),
    body: string(),
    body_html: string().optional(),
    attachments: json(),
    tool: json().optional(),
    sent_at: number(),
    received_at: number(),
    source_hash: string().optional(),
    idempotency_key: string().optional(),
    outbox_claimed_at: number().optional(),
    fail_reason: string().optional(),
    meta: json(),
  })
  .primaryKey("id");

// attendees_count is a GENERATED column, so it is not part of logical replication (A3 §7).
const calendar_events = table("calendar_events")
  .columns({
    id: string(),
    item_id: string(),
    account_id: string(),
    external_id: string(),
    start_at: number(),
    end_at: number(),
    all_day: boolean(),
    status: string(),
    attendees: json(),
    location: string().optional(),
    recurrence: string().optional(),
    updated_at: number(),
  })
  .primaryKey("id");

const persons = table("persons")
  .columns({
    id: string(),
    display_name: string(),
    org: string().optional(),
    role: string().optional(),
    relationship_state: string(),
    vip: boolean(),
    notes: string().optional(),
    first_contact_at: number().optional(),
    last_contact_at: number().optional(),
    next_followup_at: number().optional(),
    item_count: number(),
    primary_thread_id: string().optional(),
    cadence_days: number().optional(),
    priority_score: number(),
    merged_into: string().optional(),
    created_at: number(),
  })
  .primaryKey("id");

const identities = table("identities")
  .columns({
    id: string(),
    person_id: string(),
    channel: string(),
    handle: string(),
    handle_norm: string(),
    display: string().optional(),
    verified: boolean(),
    source: string(),
    created_at: number(),
  })
  .primaryKey("id");

const labels = table("labels")
  .columns({
    id: string(),
    name: string(),
    kind: string(),
    color: string().optional(),
    rule: string().optional(),
    rule_model: string().optional(),
    person_id: string().optional(),
    archived: boolean(),
    created_at: number(),
  })
  .primaryKey("id");

// probe_embedding is excluded for the same reason as items.embedding (A3 §7).
const label_rules = table("label_rules")
  .columns({
    id: string(),
    label_id: string(),
    prompt: string(),
    rule: json(),
    rule_by: string().optional(),
    rule_at: number().optional(),
    tier: string(),
    positives: json<string[]>(),
    negatives: json<string[]>(),
    hits_30d: number(),
    corrections_30d: number(),
    pinned_by_user: boolean(),
    active: boolean(),
    created_at: number(),
    updated_at: number(),
  })
  .primaryKey("id");

const item_labels = table("item_labels")
  .columns({
    item_id: string(),
    label_id: string(),
    confidence: number().optional(),
    by: string(),
    at: number(),
  })
  .primaryKey("item_id", "label_id");

const thread_labels = table("thread_labels")
  .columns({
    thread_id: string(),
    label_id: string(),
    confidence: number().optional(),
    by: string(),
    at: number(),
  })
  .primaryKey("thread_id", "label_id");

const tasks = table("tasks")
  .columns({
    id: string(),
    title: string(),
    detail: string().optional(),
    kind: string(),
    state: string(),
    owner_kind: string(),
    owner_runtime_id: string().optional(),
    source_item_id: string().optional(),
    person_id: string().optional(),
    delegated_session_id: string().optional(),
    due_at: number().optional(),
    remind_at: number().optional(),
    done_at: number().optional(),
    created_at: number(),
    created_by: string(),
  })
  .primaryKey("id");

const agent_runtimes = table("agent_runtimes")
  .columns({
    id: string(),
    runtime: string(),
    host: string(),
    display: string(),
    capabilities: json(),
    version: string().optional(),
    state: string(),
    last_seen_at: number().optional(),
    created_at: number(),
  })
  .primaryKey("id");

const agent_sessions = table("agent_sessions")
  .columns({
    id: string(),
    runtime_id: string(),
    thread_id: string(),
    session_key: string(),
    session_id: string().optional(),
    cwd: string().optional(),
    state: string(),
    summary: string().optional(),
    last_turn_at: number().optional(),
    started_at: number(),
    ended_at: number().optional(),
  })
  .primaryKey("id");

const pending_approvals = table("pending_approvals")
  .columns({
    id: string(),
    action: string(),
    args: json(),
    description: string(),
    config: json(),
    state: string(),
    decision: string().optional(),
    decided_args: json().optional(),
    requested_by: string().optional(),
    thread_id: string().optional(),
    item_id: string().optional(),
    task_id: string().optional(),
    risk: string(),
    expires_at: number().optional(),
    created_at: number(),
    decided_at: number().optional(),
    executed_at: number().optional(),
    fail_reason: string().optional(),
  })
  .primaryKey("id");

const notes = table("notes")
  .columns({
    id: string(),
    body: string(),
    routed_to_thread_id: string().optional(),
    routed_to_person_id: string().optional(),
    rationale: string().optional(),
    route_state: string(),
    created_at: number(),
  })
  .primaryKey("id");

const digests = table("digests")
  .columns({
    id: string(),
    kind: string(),
    for_date: number(),
    body: string(),
    item_ids: json<string[]>(),
    metrics: json(),
    created_at: number(),
  })
  .primaryKey("id");

// Delta §6/§10 (US-B33): settings kv. No relationships — a plain key-value table needs no joins.
// Writes go through hub HTTP (PUT /settings/:key), not Zero (contract §5).
const settings = table("settings")
  .columns({
    key: string(),
    value: json(),
    updated_at: number(),
  })
  .primaryKey("key");

// Only the three relationships the Inbox (thread list → latest item) and Thread
// (thread → items → author) screens actually use.
const threadRelationships = relationships(threads, ({ many }) => ({
  items: many({ sourceField: ["id"], destField: ["thread_id"], destSchema: items }),
}));
const itemRelationships = relationships(items, ({ one }) => ({
  thread: one({ sourceField: ["thread_id"], destField: ["id"], destSchema: threads }),
  author: one({ sourceField: ["author_person_id"], destField: ["id"], destSchema: persons }),
}));

export const zeroSchema = createSchema({
  tables: [
    accounts,
    threads,
    items,
    calendar_events,
    persons,
    identities,
    labels,
    label_rules,
    item_labels,
    thread_labels,
    tasks,
    agent_runtimes,
    agent_sessions,
    pending_approvals,
    notes,
    digests,
    settings,
  ],
  relationships: [threadRelationships, itemRelationships],
  // US-A22 deviation: without this flag, @rocicorp/zero@1.9.0's `createRunnableBuilder`
  // (= `zero.query.<table>...run()`, the pattern every screen task in interface contract §7 and
  // A5 §5 uses) returns a silent `undefined` with no schema validation (API drift #2 predicted by
  // the gate-06 spike). A21 never actually called this API path (it only tested the raw WAL
  // drain), so it stayed hidden until now.
  enableLegacyQueries: true,
  // US-A27 deviation (same drift family, the twin of #2 predicted by gate-06): CRUD mutators such
  // as `zero.mutate.<table>.update(...)` (the pattern A5-D9 DraftCard onDiscard uses — this story
  // builds no Tiptap Composer/custom mutator, so the default CRUD path is the only write path)
  // also break without `enableLegacyMutators`: `DBMutator<S>` becomes the `{}` type and has no
  // `.items` property at all (zero-client/src/client/crud.d.ts). A22 never wrote anything, so it
  // stayed hidden until now.
  enableLegacyMutators: true,
}) satisfies Schema;

export const ZERO_TABLES: readonly string[] = Object.keys(zeroSchema.tables);
export const ZERO_ITEM_COLUMNS: readonly string[] = Object.keys(zeroSchema.tables.items.columns);
export const ZERO_LABEL_RULE_COLUMNS: readonly string[] = Object.keys(
  zeroSchema.tables.label_rules.columns,
);

// US-A21b: deployed without permissions, zero-cache falls back to "no tables will be syncable"
// and never sends a single row down (the warning in deploy-permissions.js) — this is what US-A22
// saw as "the query resolves but there are no rows". Single-user hub, so there is only one rule:
// if the sub of the hub-signed token is this user, everything is readable.
export type AuthData = { sub: string };

/** Must equal the JWT `sub` value the hub signs (OMNIS_USER_ID in apps/hub/src/config.ts). */
export const OMNIS_USER_ID: string = globalThis.process?.env?.OMNIS_USER_ID ?? "logan";

// Write permissions are deliberately left empty: the desktop is read-only and every write goes
// through hub HTTP (contract §5). Without insert/update/delete, Zero rejects them on the server.
const readOnlyForOwner = {
  row: {
    // Same shape as ANYONE_CAN: a table-agnostic rule, so eb's table parameter is never.
    select: [
      (authData: AuthData, eb: ExpressionBuilder<never, Schema>) =>
        eb.cmpLit(authData.sub, "=", OMNIS_USER_ID),
    ],
  },
};

export const permissions = definePermissions<AuthData, typeof zeroSchema>(zeroSchema, () =>
  Object.fromEntries(ZERO_TABLES.map((t) => [t, readOnlyForOwner])),
);

// The zero-deploy-permissions CLI looks for the names `schema` and `permissions` in the module
// (isSchemaConfig in zero-schema/src/schema-config.js).
export { zeroSchema as schema };
