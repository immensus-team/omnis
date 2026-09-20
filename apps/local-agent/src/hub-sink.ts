import {
  type BridgeMethod,
  type HumanInterrupt,
  type HumanResponse,
  HumanResponse as HumanResponseSchema,
} from "@omnis/protocol";
import type { HubClient } from "./hub-client.js";
import type { Logger } from "./logger.js";
import type { Outbox } from "./outbox.js";
import type { EventSink } from "./rpc-dispatch.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";

export interface HubSinkDeps {
  client: HubClient;
  session: SessionRecord;
  turnId: string;
  logger: Logger;
  /** A2 §2.2: while disconnected only durable events are queued. Without one, durable events are dropped too (for tests and seeding). */
  outbox?: Outbox;
  registry?: SessionRegistry;
}

/**
 * The adapter's EventSink → hub bridge notification (A2 §3.3). The only production path by which a
 * runtime event becomes an inbox item — what is fired here is written into items by apps/hub/src/bridge.ts.
 */
export function createHubSink(deps: HubSinkDeps): EventSink {
  const { client, logger, session, turnId } = deps;

  const durable = (method: BridgeMethod, params: Record<string, unknown>): void => {
    try {
      client.notify(method, params);
    } catch {
      deps.outbox?.append({ method, params });
    }
  };
  const ephemeral = (method: BridgeMethod, params: Record<string, unknown>): void => {
    try {
      client.notify(method, params);
    } catch {
      /* A2-D4: deltas are neither stored nor resent */
    }
  };

  return {
    itemStarted: (e) => {
      // ClaudeCodeAdapter also funnels session.registered and health through this slot (the
      // `sink.itemStarted(emit.params)` call in claude-code.ts) — EventSink has no slot for those two. It is split by shape.
      // ponytail: the proper fix is adding notify(method, params) to EventSink, but that means touching
      // 2 adapters + 3 test sinks at once. When a third similar event actually appears, do it then.
      if (typeof e.session_id === "string") {
        durable("session.registered", {
          runtime: session.runtime,
          session_key: session.session_key,
          session_id: e.session_id,
          state: "running",
        });
        deps.registry?.bindSessionId(session.session_key, e.session_id);
        return;
      }
      if (e.limited === true) {
        durable("health", { runtime: session.runtime, state: "degraded" });
        return;
      }
      durable("turn.item.started", e);
    },
    delta: (e) => ephemeral("turn.item.delta", e),
    itemCompleted: (e) => durable("turn.item.completed", e),
    turnStarted: (e) => durable("turn.started", e),
    turnCompleted: (e) => durable("turn.completed", e),
    approval: async (i: HumanInterrupt): Promise<HumanResponse> => {
      const raw = await client.request("approval.requested", {
        session_key: session.session_key,
        turn_id: turnId,
        interrupt: i,
      });
      return HumanResponseSchema.parse(raw);
    },
    raw: (line) => logger.debug("runtime raw", { session_key: session.session_key, line }),
  };
}
