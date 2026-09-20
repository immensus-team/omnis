import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { EgressToken } from "./egress.js";

export interface OutboxDeps {
  /** 채널 → 어댑터. 이 Map은 클로저 밖으로 나가지 않는다. */
  adapters: ReadonlyMap<string, Adapter>;
}

export interface Outbox {
  send(token: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult>;
}

/** 채널 send()에 닿는 유일한 지점. 토큰이 없으면 컴파일되지 않고, 어댑터는 밖으로 새지 않는다. */
export function createOutbox(deps: OutboxDeps): Outbox {
  const { adapters } = deps;
  return {
    async send(token, ref, draft) {
      void token; // 존재 자체가 승인 증거다
      const channel = ref.accountId.includes(":") ? ref.accountId.split(":")[0] : undefined;
      const adapter = channel !== undefined ? adapters.get(channel) : [...adapters.values()][0];
      if (adapter === undefined) {
        throw new Error(`no adapter registered for thread ${ref.accountId}/${ref.externalId}`);
      }
      return adapter.send(ref, draft);
    },
  };
}
