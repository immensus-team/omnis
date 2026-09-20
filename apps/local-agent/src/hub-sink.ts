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
  /** A2 §2.2: 끊겨 있는 동안 durable만 쌓는다. 없으면 durable도 버린다(테스트·시드용). */
  outbox?: Outbox;
  registry?: SessionRegistry;
}

/**
 * 어댑터의 EventSink → 허브 브리지 알림(A2 §3.3). 런타임 이벤트가 인박스 item이 되는 유일한
 * 프로덕션 경로다 — 여기서 쏜 것을 apps/hub/src/bridge.ts가 items에 쓴다.
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
      /* A2-D4: 델타는 저장도 재전송도 하지 않는다 */
    }
  };

  return {
    itemStarted: (e) => {
      // ClaudeCodeAdapter는 session.registered와 health도 이 칸으로 흘린다(claude-code.ts의
      // `sink.itemStarted(emit.params)`) — EventSink에 그 둘을 위한 칸이 없어서다. 모양으로 가른다.
      // ponytail: 제대로 된 수리는 EventSink에 notify(method, params)를 더하는 것이지만
      // 어댑터 2종 + 테스트 sink 3벌을 같이 고쳐야 한다. 실제로 세 번째 유사 이벤트가 생기면 그때.
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
