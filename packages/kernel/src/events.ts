import { NOTIFY_CHANNELS, query } from "@omnis/db";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

export type EventTier = "ephemeral" | "durable" | "cold";

export interface Events {
  /** ephemeral: 프로세스 안 팬아웃만(저장·NOTIFY 없음, A3-D14).
   *  durable: 호출자가 이미 쓴 row의 id를 NOTIFY로 알린다.
   *  cold: events 테이블 INSERT(트리거가 없어 NOTIFY 없음). */
  emit(
    tier: EventTier,
    kind: string,
    payload: { id?: string; [k: string]: unknown },
  ): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
}

/** durable 이벤트 kind → NOTIFY 채널(계약 §4). 여기 없는 kind는 durable로 쏠 수 없다. */
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

/** A3 §6.2: NOTIFY 페이로드 한도. */
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
      // 채널 이름은 식별자라 파라미터화할 수 없다. NOTIFY_CHANNELS는 고정 상수이므로 주입 경로가 없다.
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
        // LISTEN이 아직 걸리는 중이면 기다린다 — pg_notify는 그 순간 듣고 있는 세션에만 닿는다.
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
        c.release(true); // 이 커넥션은 LISTEN 상태이므로 풀에 돌려주지 않고 버린다
      }
    },
  };
}
