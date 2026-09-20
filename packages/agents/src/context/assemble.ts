// A4 §1.3: there is exactly one assembler function. A loop only declares slots.
// Cache boundary discipline: tools → system → up to the selfModel snapshot is cachedPrefix;
// everything after it is volatile.
// Timestamps, run_id, and nonce must always sit after the boundary (breach it and cache-hit
// $0.003/M becomes miss $0.15/M).
import {
  type SelfModelFile,
  asOf,
  estimateTokens,
  loadSelfModel,
  searchMemories,
} from "@omnis/memory";
import type { Pool } from "pg";
import { getAgentsPool } from "../pool.js";
import { newNonce, normalizeExternal, wrapData } from "./normalize.js";

export interface ContextRequest {
  selfModel?: SelfModelFile[];
  memories?: { query: string; k: number; minScore?: number };
  entities?: { personIds?: string[]; asOf?: "now" | string };
  thread?: { threadId: string; lastN: number; includeToolCalls?: boolean };
  calendar?: { windowHours: number };
  tasks?: { state: "open" | "all"; limit: number };
  sessions?: { sessionKeys: string[]; lastN: number };
}

export interface DataBlock {
  id: string;
  source: string;
  text: string;
}

export interface AssembledContext {
  cachedPrefix: string;
  volatile: DataBlock[];
  tokenEstimate: number;
  truncated: boolean;
  provenance: Array<{ slot: string; itemIds: string[]; memoryIds: string[] }>;
}

/** ponytail: LoopSpec.budget.inputTokens (US-B06) carries a per-loop budget, but ContextRequest has
 *  no budget slot (fixed by delta §4). Keep a module default and let the loop runner arm its own
 *  budget with setContextBudget() before the call. Once the slot is added to the contract, this
 *  global goes away. */
export const CONTEXT_INPUT_BUDGET_TOKENS = 12_000;
let budget = CONTEXT_INPUT_BUDGET_TOKENS;

export function setContextBudget(tokens: number): void {
  budget = tokens;
}

interface ThreadTurn {
  item_id: string;
  author: string;
  sent_at: Date;
  body: string;
}

interface Slots {
  selfModel: Partial<Record<SelfModelFile, string>>;
  memoryHits: Array<{ memory_id: string; content: string; score: number; recorded_at: string }>;
  turns: ThreadTurn[];
  calendarHours: number;
  calendar: Array<{ item_id: string; title: string; start_at: Date; end_at: Date }>;
  tasks: Array<{ task_id: string; title: string; state: string; due_at: Date | null }>;
  entities: Array<{ id: string; type: string; name: string; attributes: Record<string, unknown> }>;
  sessions: Array<{ session_key: string; state: string; summary: string | null }>;
}

const SELF_MODEL_ORDER: readonly SelfModelFile[] = ["USER.md", "VOICE.md", "PROJECTS.md"];

function renderPrefix(files: Partial<Record<SelfModelFile, string>>): string {
  const parts: string[] = [];
  for (const f of SELF_MODEL_ORDER) {
    const body = files[f];
    if (body === undefined) continue;
    parts.push(body.trimEnd());
  }
  if (parts.length === 0) return "";
  return `## About me (the user)\n${parts.join("\n\n")}\n`;
}

/** A4 §1.3 truncation stage 4: "per-recipient samples → fall back to channel default samples".
 *  It only peels off the section in VOICE.md that starts with `## 상대별` (the Korean heading for
 *  "per recipient") — that Korean matcher is FROZEN, so leave it verbatim. No further file-format
 *  enforcement.
 *  `(?:(?!^##\s)[\s\S])*` means "up to the next `## ` line or end of file". JS has no `\Z`, so a
 *  lookahead like `(?=^##\s|\Z)` silently searches for a literal `Z` and deletes nothing. */
function stripVoiceSamples(voice: string): string {
  return voice.replace(/^##\s*상대별[^\n]*\n(?:(?!^##\s)[\s\S])*/gm, "").trimEnd();
}

export async function buildContext(req: ContextRequest): Promise<AssembledContext> {
  // ponytail: the pool is only acquired when a DB-backed slot is actually requested. Forcing
  // configureAgents() on a loop (or unit test) that only asks for selfModel would tie the
  // assembler to the DB.
  let poolRef: Pool | null = null;
  const db = (): Pool => {
    poolRef ??= getAgentsPool();
    return poolRef;
  };

  const nonce = newNonce();
  const now = new Date();
  const provenance: AssembledContext["provenance"] = [];

  const slots: Slots = {
    selfModel: {},
    memoryHits: [],
    turns: [],
    calendarHours: req.calendar?.windowHours ?? 0,
    calendar: [],
    tasks: [],
    entities: [],
    sessions: [],
  };

  if (req.selfModel !== undefined && req.selfModel.length > 0) {
    slots.selfModel = { ...(await loadSelfModel(req.selfModel)).files };
    provenance.push({ slot: "selfModel", itemIds: [], memoryIds: [] });
  }

  if (req.memories !== undefined) {
    slots.memoryHits = await searchMemories(db(), {
      query: req.memories.query,
      k: req.memories.k,
      ...(req.memories.minScore === undefined ? {} : { minScore: req.memories.minScore }),
    });
    provenance.push({
      slot: "memories",
      itemIds: [],
      memoryIds: slots.memoryHits.map((h) => h.memory_id),
    });
  }

  if (req.thread !== undefined) {
    const kinds =
      req.thread.includeToolCalls === true
        ? ["message", "email", "event", "agent_turn", "tool_call", "system"]
        : ["message", "email", "event", "agent_turn", "system"];
    const { rows } = await db().query<ThreadTurn>(
      `SELECT i.id AS item_id,
              COALESCE(p.display_name, CASE WHEN i.author_is_me THEN 'me' ELSE 'unknown' END) AS author,
              i.sent_at, i.body
         FROM items i
         LEFT JOIN persons p ON p.id = i.author_person_id
        WHERE i.thread_id = $1 AND i.kind = ANY($3)
        ORDER BY i.sent_at DESC
        LIMIT $2`,
      [req.thread.threadId, req.thread.lastN, kinds],
    );
    slots.turns = rows.reverse();
    provenance.push({ slot: "thread", itemIds: slots.turns.map((t) => t.item_id), memoryIds: [] });
  }

  if (req.calendar !== undefined) {
    const { rows } = await db().query<Slots["calendar"][number]>(
      `SELECT ce.item_id, COALESCE(i.subject, '(no title)') AS title, ce.start_at, ce.end_at
         FROM calendar_events ce JOIN items i ON i.id = ce.item_id
        WHERE ce.status <> 'cancelled'
          AND ce.start_at BETWEEN $1::timestamptz - make_interval(hours => $2)
                              AND $1::timestamptz + make_interval(hours => $2)
        ORDER BY ce.start_at`,
      [now, req.calendar.windowHours],
    );
    slots.calendar = rows;
    provenance.push({
      slot: "calendar",
      itemIds: slots.calendar.map((e) => e.item_id),
      memoryIds: [],
    });
  }

  if (req.tasks !== undefined) {
    const { rows } = await db().query<Slots["tasks"][number]>(
      `SELECT id AS task_id, title, state, due_at FROM tasks
        WHERE ($1 = 'all' OR state = 'open')
        ORDER BY COALESCE(due_at, 'infinity'::timestamptz), created_at
        LIMIT $2`,
      [req.tasks.state, req.tasks.limit],
    );
    slots.tasks = rows;
    provenance.push({ slot: "tasks", itemIds: [], memoryIds: [] });
  }

  if (req.entities !== undefined) {
    const at = req.entities.asOf ?? "now";
    const out: Slots["entities"] = [];
    for (const personId of req.entities.personIds ?? []) {
      for (const e of await asOf(db(), { personId, at })) {
        out.push({ id: e.id, type: e.type, name: e.name, attributes: e.attributes ?? {} });
      }
    }
    slots.entities = out;
    provenance.push({ slot: "entities", itemIds: [], memoryIds: [] });
  }

  if (req.sessions !== undefined && req.sessions.sessionKeys.length > 0) {
    const { rows } = await db().query<Slots["sessions"][number]>(
      `SELECT session_key, state, summary FROM agent_sessions
        WHERE session_key = ANY($1) ORDER BY last_turn_at DESC NULLS LAST`,
      [req.sessions.sessionKeys],
    );
    slots.sessions = rows;
    provenance.push({ slot: "sessions", itemIds: [], memoryIds: [] });
  }

  // ── render + truncate ────────────────────────────────────────────────────
  const render = (): { prefix: string; blocks: DataBlock[]; tokens: number } => {
    const prefix = renderPrefix(slots.selfModel);
    const blocks = renderBlocks(slots, nonce, now);
    const tokens =
      estimateTokens(prefix) + blocks.reduce((sum, b) => sum + estimateTokens(b.text), 0);
    return { prefix, blocks, tokens };
  };

  // The 5 stages of A4-D15. Each function returns "true if it trimmed one stage's worth".
  // USER.md and the last 3 turns of the thread are touched by no stage.
  const steps: Array<() => boolean> = [
    () => {
      // 1. Middle turns of the thread (oldest first). The first turn and the last 3 turns are preserved.
      const first = slots.turns[0];
      if (first === undefined || slots.turns.length <= 4) return false;
      slots.turns = [first, ...slots.turns.slice(2)];
      return true;
    },
    () => {
      // 2. Lower-scoring memories first (halve k) — searchMemories is already in score order.
      if (slots.memoryHits.length <= 1) return false;
      slots.memoryHits = slots.memoryHits.slice(0, Math.floor(slots.memoryHits.length / 2));
      return true;
    },
    () => {
      // 3. Halve the calendar window (±window)
      if (slots.calendar.length === 0 || slots.calendarHours <= 1) return false;
      slots.calendarHours = Math.floor(slots.calendarHours / 2);
      const cutoffMs = slots.calendarHours * 3_600_000;
      slots.calendar = slots.calendar.filter(
        (e) => Math.abs(e.start_at.getTime() - now.getTime()) <= cutoffMs,
      );
      return true;
    },
    () => {
      // 4. Remove the per-recipient samples from VOICE.md (leaving only the channel default samples)
      const voice = slots.selfModel["VOICE.md"];
      if (voice === undefined) return false;
      const stripped = stripVoiceSamples(voice);
      if (stripped === voice) return false;
      slots.selfModel = { ...slots.selfModel, "VOICE.md": stripped };
      return true;
    },
    () => {
      // 5. Remove PROJECTS.md entirely
      if (slots.selfModel["PROJECTS.md"] === undefined) return false;
      const { "PROJECTS.md": _dropped, ...rest } = slots.selfModel;
      slots.selfModel = rest;
      return true;
    },
  ];

  let truncated = false;
  let current = render();
  for (const step of steps) {
    if (current.tokens <= budget) break;
    while (current.tokens > budget && step()) {
      truncated = true;
      current = render();
    }
  }

  return {
    cachedPrefix: current.prefix,
    volatile: current.blocks,
    tokenEstimate: current.tokens,
    truncated,
    provenance,
  };
}

function renderBlocks(slots: Slots, nonce: string, now: Date): DataBlock[] {
  const asOfIso = now.toISOString();
  const blocks: DataBlock[] = [];
  const push = (source: string, body: string): void => {
    if (body.trim() === "") return;
    blocks.push({
      id: `d_${nonce}`,
      source,
      text: wrapData(normalizeExternal(body, nonce), { nonce, source, asOf: asOfIso }),
    });
  };

  if (slots.memoryHits.length > 0) {
    push(
      "memory",
      slots.memoryHits
        .map((h) => `[memory_id=${h.memory_id} recorded_at=${h.recorded_at}] ${h.content}`)
        .join("\n"),
    );
  }
  if (slots.turns.length > 0) {
    push(
      "thread",
      slots.turns
        .map((t) => `[item_id=${t.item_id} ${t.sent_at.toISOString()}] ${t.author}: ${t.body}`)
        .join("\n"),
    );
  }
  if (slots.calendar.length > 0) {
    push(
      "calendar",
      slots.calendar
        .map((e) => `${e.start_at.toISOString()}~${e.end_at.toISOString()} ${e.title}`)
        .join("\n"),
    );
  }
  if (slots.tasks.length > 0) {
    push(
      "tasks",
      slots.tasks
        .map(
          (t) =>
            `[task_id=${t.task_id} ${t.state}] ${t.title}${t.due_at === null ? "" : ` (due ${t.due_at.toISOString()})`}`,
        )
        .join("\n"),
    );
  }
  if (slots.entities.length > 0) {
    push(
      "entities",
      slots.entities.map((e) => `[${e.type}] ${e.name} ${JSON.stringify(e.attributes)}`).join("\n"),
    );
  }
  if (slots.sessions.length > 0) {
    push(
      "sessions",
      slots.sessions
        .map((s) => `[${s.session_key} ${s.state}] ${s.summary ?? "(no summary)"}`)
        .join("\n"),
    );
  }
  return blocks;
}
