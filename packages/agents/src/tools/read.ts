// A4 §1.5 read tools. No side effects — SELECT only.
import { asOf, searchMemories } from "@omnis/memory";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { getAgentsPool } from "../pool.js";

export const READ_TOOLS: ToolSet = {
  read_thread: tool({
    description: "Read one thread and its recent items.",
    inputSchema: z.object({
      thread_id: z.string().uuid(),
      last_n: z.number().int().max(50).default(12),
    }),
    execute: async ({ thread_id, last_n }) => {
      const pool = getAgentsPool();
      const head = await pool.query<{ kind: string; title: string | null; participants: string[] }>(
        "SELECT kind, title, participants FROM threads WHERE id = $1",
        [thread_id],
      );
      const items = await pool.query<{
        id: string;
        author_is_me: boolean;
        sent_at: Date;
        body: string;
        subject: string | null;
      }>(
        `SELECT id, author_is_me, sent_at, body, subject FROM items
          WHERE thread_id = $1 ORDER BY sent_at DESC LIMIT $2`,
        [thread_id, last_n],
      );
      return {
        thread_id,
        kind: head.rows[0]?.kind ?? null,
        title: head.rows[0]?.title ?? null,
        participants: head.rows[0]?.participants ?? [],
        items: items.rows.reverse().map((r) => ({
          item_id: r.id,
          author: r.author_is_me ? "me" : "them",
          sent_at: r.sent_at.toISOString(),
          subject: r.subject,
          body: r.body,
        })),
      };
    },
  }),

  search_memory: tool({
    description: "Semantic search over memories.",
    inputSchema: z.object({
      query: z.string(),
      k: z.number().int().max(20).default(6),
      kinds: z.array(z.enum(["fact", "preference", "event"])).optional(),
    }),
    execute: async ({ query, k, kinds }) => ({
      results: await searchMemories(getAgentsPool(), {
        query,
        k,
        ...(kinds !== undefined ? { kinds } : {}),
      }),
    }),
  }),

  read_person: tool({
    description: "Read one person's profile and channel identities.",
    inputSchema: z.object({
      person_id: z.string().uuid().optional(),
      handle: z.string().optional(),
      channel: z.string().optional(),
    }),
    execute: async ({ person_id, handle, channel }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT p.id AS person_id, p.display_name AS display, p.relationship_state, p.vip,
                p.first_contact_at, p.last_contact_at, p.org, p.role,
                COALESCE(jsonb_agg(jsonb_build_object('channel', i.channel, 'handle', i.handle))
                         FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS identities
           FROM persons p LEFT JOIN identities i ON i.person_id = p.id
          WHERE p.merged_into IS NULL
            AND ($1::uuid IS NULL OR p.id = $1)
            AND ($2::text IS NULL OR (i.handle_norm = $2 AND i.channel = $3))
          GROUP BY p.id LIMIT 1`,
        [person_id ?? null, handle ?? null, channel ?? null],
      );
      return rows[0] ?? null;
    },
  }),

  read_entity: tool({
    description: "Read an entity as of a given time (bi-temporal).",
    inputSchema: z.object({ entity_id: z.string().uuid(), as_of: z.string().optional() }),
    execute: async ({ entity_id, as_of }) => ({
      entities: await asOf(getAgentsPool(), { entityId: entity_id, at: as_of ?? "now" }),
    }),
  }),

  read_calendar: tool({
    description: "Read calendar events within a time range.",
    inputSchema: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
    execute: async ({ from, to }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT c.id AS event_id, i.subject AS title, c.start_at, c.end_at, c.attendees, c.location
           FROM calendar_events c JOIN items i ON i.id = c.item_id
          WHERE c.status <> 'cancelled' AND c.start_at < $2 AND c.end_at > $1
          ORDER BY c.start_at LIMIT 50`,
        [from, to],
      );
      return { events: rows };
    },
  }),

  read_tasks: tool({
    description: "Read the task list.",
    inputSchema: z.object({
      state: z.enum(["open", "done", "all"]).default("open"),
      limit: z.number().int().max(50).default(20),
    }),
    execute: async ({ state, limit }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT id AS task_id, title, kind, state, due_at, owner_kind, owner_runtime_id, source_item_id
           FROM tasks
          WHERE ($1 = 'all') OR ($1 = 'open' AND state IN ('open','in_progress'))
             OR ($1 = 'done' AND state = 'done')
          ORDER BY due_at NULLS LAST, created_at DESC LIMIT $2`,
        [state, limit],
      );
      return { tasks: rows };
    },
  }),

  read_session: tool({
    description:
      "Read an agent session's durable summary and its last N turns. There are no raw logs (master §9).",
    inputSchema: z.object({
      session_key: z.string(),
      last_n: z.number().int().max(20).default(5),
    }),
    execute: async ({ session_key, last_n }) => {
      const pool = getAgentsPool();
      const s = await pool.query<{
        id: string;
        state: string;
        summary: string | null;
        runtime: string;
        host: string;
      }>(
        `SELECT s.id, s.state, s.summary, r.runtime, r.host
           FROM agent_sessions s JOIN agent_runtimes r ON r.id = s.runtime_id
          WHERE s.session_key = $1 ORDER BY s.started_at DESC LIMIT 1`,
        [session_key],
      );
      const head = s.rows[0];
      if (head === undefined) return null;
      const turns = await pool.query<{ author_is_me: boolean; body: string; sent_at: Date }>(
        `SELECT i.author_is_me, i.body, i.sent_at FROM items i
           JOIN agent_sessions ag ON ag.thread_id = i.thread_id
          WHERE ag.id = $1 AND i.kind IN ('agent_turn','tool_call')
          ORDER BY i.sent_at DESC LIMIT $2`,
        [head.id, last_n],
      );
      return {
        session_key,
        runtime: head.runtime,
        host: head.host,
        state: head.state,
        summary: head.summary,
        turns: turns.rows.reverse().map((t) => ({
          role: t.author_is_me ? "me" : "agent",
          text: t.body,
          at: t.sent_at.toISOString(),
        })),
      };
    },
  }),
};
