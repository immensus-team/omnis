import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { EgressToken } from "./egress.js";

export interface OutboxDeps {
  /** channel → adapter. This Map never escapes the closure. */
  adapters: ReadonlyMap<string, Adapter>;
}

export interface Outbox {
  send(token: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult>;
}

/** The only path that reaches a channel send(). It does not compile without a token, and the
 *  adapters never leak out. */
export function createOutbox(deps: OutboxDeps): Outbox {
  const { adapters } = deps;
  return {
    async send(token, ref, draft) {
      void token; // its mere existence is the approval evidence
      const channel = ref.accountId.includes(":") ? ref.accountId.split(":")[0] : undefined;
      const adapter = channel !== undefined ? adapters.get(channel) : [...adapters.values()][0];
      if (adapter === undefined) {
        throw new Error(`no adapter registered for thread ${ref.accountId}/${ref.externalId}`);
      }
      return adapter.send(ref, draft);
    },
  };
}
