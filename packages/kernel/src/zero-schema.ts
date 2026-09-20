// 복제 범위의 단일 소스. A3 §7의 publication(0008_publication.sql)과 반드시 일치한다 —
// 일치 검사는 assertZeroPublication이 부팅 때마다 한다.
import {
  type Schema,
  boolean,
  createSchema,
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

// A3 §7: embedding(768d × 4B)과 생성 컬럼 search_tsv는 폰까지 끌고 가지 않는다.
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

// attendees_count는 GENERATED 컬럼이라 논리 복제 대상이 아니다(A3 §7).
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

// probe_embedding은 items.embedding과 같은 이유로 제외(A3 §7).
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

// Inbox(스레드 목록 → 마지막 item)와 Thread(스레드 → item들 → 작성자) 화면이 실제로 타는 3개만.
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
  ],
  relationships: [threadRelationships, itemRelationships],
}) satisfies Schema;

export const ZERO_TABLES: readonly string[] = Object.keys(zeroSchema.tables);
export const ZERO_ITEM_COLUMNS: readonly string[] = Object.keys(zeroSchema.tables.items.columns);
export const ZERO_LABEL_RULE_COLUMNS: readonly string[] = Object.keys(
  zeroSchema.tables.label_rules.columns,
);
