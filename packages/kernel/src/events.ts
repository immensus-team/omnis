import { NOTIFY_CHANNELS, query } from "@omnis/db";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

export type EventTier = "ephemeral" | "durable" | "cold";

export interface Events {
  /** ephemeral: in-process fanout only (no persistence, no NOTIFY, A3-D14).
   *  durable: NOTIFY the id of the row the caller has already written.
   *  cold: INSERT into the events table (no trigger, so no NOTIFY). */
  emit(
    tier: EventTier,
    kind: string,
    payload: { id?: string; [k: string]: unknown },
  ): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
}

/** durable event kind → NOTIFY channel (contract §4). A kind missing here cannot be
 *  emitted as durable. */
export const DURABLE_CHANNEL: Readonly<Record<string, string>> = {
  "item.created": "omnis_item",
  "item.updated": "omnis_item",
  "thread.created": "omnis_thread",
  "thread.updated": "omnis_thread",
  "approval.requested": "omnis_approval",
  "approval.decided": "omnis_approval",
  "task.created": "omnis_task",
  "task.updated": "omnis_task",
  "session.updated": "omnis_session",
  "job.due": "omnis_job",
  "control.kill_switch": "omnis_control",
};

/** A3 §6.2: NOTIFY payload limit. */
export const NOTIFY_MAX_BYTES = 8000;

export interface EventsDeps {
  pool: Pool;
  logger: Logger;
}

export function createEvents(deps: EventsDeps): Events & { close(): Promise<void> } {
  const { pool, logger } = deps;
  const subs = new Map<string, Set<(p: Record<string, unknown>) => void>>();
  let listener: PoolClient | null = null;
  let listening: Promise<void> | null = null;
  let closed = false;

  function fanout(channel: string, payload: Record<string, unknown>): void {
    const fns = subs.get(channel);
    if (fns === undefined) return;
    for (const fn of [...fns]) {
      try {
        fn(payload);
      } catch (e) {
        logger.error("subscriber threw", {
          channel,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  async function ensureListener(): Promise<void> {
    if (closed) return;
    if (listening !== null) return listening;
    listening = (async () => {
      const c = await pool.connect();
      c.on("notification", (msg) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(msg.payload ?? "{}") as Record<string, unknown>;
        } catch {
          logger.warn("unparsable NOTIFY payload", { channel: msg.channel });
          return;
        }
        fanout(msg.channel, payload);
      });
      // Channel names are identifiers, so they cannot be parameterized. NOTIFY_CHANNELS is a
      // fixed constant, so there is no injection path.
      for (const ch of NOTIFY_CHANNELS) {
        await c.query(`LISTEN ${ch}`);
      }
      listener = c;
    })();
    return listening;
  }

  return {
    async emit(tier, kind, payload) {
      if (tier === "ephemeral") {
        fanout(kind, payload);
        return;
      }
      if (tier === "durable") {
        const channel = DURABLE_CHANNEL[kind];
        if (channel === undefined) {
          throw new Error(`durable event "${kind}" has no NOTIFY channel (kernel/events.ts)`);
        }
        const text = JSON.stringify(payload);
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes >= NOTIFY_MAX_BYTES) {
          throw new Error(`NOTIFY payload for "${kind}" is ${bytes}B, limit ${NOTIFY_MAX_BYTES}`);
        }
        // If LISTEN is still being set up, wait for it — pg_notify only reaches sessions
        // listening at that instant.
        if (listening !== null) await listening;
        await query(pool, "SELECT pg_notify($1, $2)", [channel, text]);
        return;
      }
      await query(
        pool,
        `INSERT INTO events (kind, actor, target_table, target_id, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          kind,
          typeof payload.actor === "string" ? payload.actor : "system",
          typeof payload.target_table === "string" ? payload.target_table : null,
          typeof payload.id === "string" && /^[0-9a-f-]{36}$/.test(payload.id) ? payload.id : null,
          JSON.stringify(payload),
        ],
      );
    },

    subscribe(channel, fn) {
      if (channel.startsWith("omnis_") && !NOTIFY_CHANNELS.includes(channel)) {
        throw new Error(`unknown omnis_ channel: ${channel}`);
      }
      let fns = subs.get(channel);
      if (fns === undefined) {
        fns = new Set();
        subs.set(channel, fns);
      }
      fns.add(fn);
      if (channel.startsWith("omnis_")) {
        void ensureListener().catch((e: unknown) => {
          logger.error("LISTEN failed", { err: e instanceof Error ? e.message : String(e) });
        });
      }
      return () => {
        const set = subs.get(channel);
        set?.delete(fn);
      };
    },

    async close() {
      closed = true;
      subs.clear();
      const pending = listening;
      listening = null;
      if (pending !== null) await pending.catch(() => undefined);
      const c = listener;
      listener = null;
      if (c !== null) {
        c.removeAllListeners("notification");
        c.release(true); // in LISTEN state — discard, do not return to the pool
      }
    },
  };
}
