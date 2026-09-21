import {
  BRIDGE_ERRORS,
  BridgeError,
  type RuntimeCapabilities,
  type RuntimeKind,
  type TurnInput,
} from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";

// UNVERIFIED: Hermes SSE field names — tools/spikes/gate-hermes-sse/result.md

export interface HermesConfig {
  baseUrl: string;
  token: string;
  /** US-C06 (C-D6): mirrors this host's TOML `delegation = true`. Absent/false keeps the Phase B read-only rule
   *  (A2-D9) — Hermes is only promoted to a delegation target once S-A2-5 confirms its command-approval surface. */
  delegation?: boolean;
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export interface HermesCapabilitiesResponse {
  session_key_header: string;
  session_id_header?: string;
  models?: string[];
}

/** A2 §4.4: approvals cannot arise in Phase B (origin='human' only, delegation excluded, A2-D9), so the approval
 *  surface is reported as `none` unless this host opted into delegation (US-C06, C-D6).
 *  `resume`/`stream_deltas` are VERIFIED by `09` (session_key/session_id split, SSE keepalive). The rest are
 *  fields Hermes does not self-describe verbatim, so they are pinned conservatively to match the Phase B scope. */
export function parseHermesCapabilities(
  raw: HermesCapabilitiesResponse,
  delegation = false,
): RuntimeCapabilities {
  return {
    resume: true,
    cross_project_resume: false,
    stream_deltas: true,
    reasoning_stream: false,
    tool_calls: false,
    approvals: delegation ? "native" : "none",
    cancel: true,
    models: raw.models ?? [],
    features: [],
  };
}

/** A2 §2.1: if session_key_header differs from session_header_mode ('hermes_v1' = X-Hermes-Session-Key),
 *  this runtime is registered as degraded and no session is opened — the caller of probe() (bridge bootstrap code,
 *  outside this plan) catches the error and drops AgentRuntime.state to 'degraded'. */
export class HermesSessionHeaderMismatchError extends Error {
  constructor(readonly got: string) {
    super(
      `Hermes GET /v1/capabilities returned session_key_header='${got}', expected 'X-Hermes-Session-Key' (A2 §2.1)`,
    );
    this.name = "HermesSessionHeaderMismatchError";
  }
}

const EXPECTED_SESSION_KEY_HEADER = "X-Hermes-Session-Key";

/** A2-D9: an HTTP-shaped RuntimeAdapter that spawns no process. It maps session_key
 *  one-to-one onto X-Hermes-Session-Key and uses the response's X-Hermes-Session-Id for the next turn's
 *  previous_response_id chaining (§4.4: "this mapping is 1:1, so this adapter is the thinnest"). */
export class HermesAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = "hermes";
  readonly #lastResponseId = new Map<string, string>();
  constructor(private readonly cfg: HermesConfig) {}

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const res = await fetchFn(`${this.cfg.baseUrl}/v1/capabilities`, {
      headers: { authorization: `Bearer ${this.cfg.token}` },
    });
    if (!res.ok) {
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `Hermes /v1/capabilities failed: ${res.status}`,
      );
    }
    const body = (await res.json()) as HermesCapabilitiesResponse;
    if (body.session_key_header !== EXPECTED_SESSION_KEY_HEADER) {
      throw new HermesSessionHeaderMismatchError(body.session_key_header);
    }
    return {
      version: "hermes",
      capabilities: parseHermesCapabilities(body, this.cfg.delegation === true),
    };
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    // US-C06 (A2-D9): 'human' always; 'delegation' only on a host whose TOML opted in.
    const delegating = this.cfg.delegation === true;
    if (s.origin !== "human" && !(delegating && s.origin === "delegation")) {
      throw new BridgeError(
        BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
        delegating
          ? `Hermes accepts only 'human' and 'delegation' origins, got '${s.origin}' (A2-D9)`
          : "Hermes sessions are read-only on this host — origin must be 'human' (A2-D9); set delegation = true in its [[runtime]] block to accept delegation",
      );
    }
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const now = this.cfg.now ?? ((): Date => new Date());
    const turnId = `t-${Date.now().toString(36)}`;
    const controller = new AbortController();
    const previousResponseId = this.#lastResponseId.get(s.session_key);
    const body: Record<string, unknown> =
      previousResponseId === undefined || previousResponseId === ""
        ? { conversation: s.session_key, input: input.text }
        : { previous_response_id: previousResponseId, input: input.text };

    const res = await fetchFn(`${this.cfg.baseUrl}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
        "X-Hermes-Session-Key": s.session_key,
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || res.body === null) {
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `Hermes /v1/responses failed: ${res.status}`,
      );
    }
    // §4.4: the next turn chains on this id (session_key stays, only session_id differs).
    const sessionId = res.headers.get("X-Hermes-Session-Id");
    if (sessionId !== null) this.#lastResponseId.set(s.session_key, sessionId);

    sink.turnStarted({ session_key: s.session_key, turn_id: turnId, at: now().toISOString() });
    void this.#pump(res.body, s.session_key, turnId, sessionId, sink);

    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        controller.abort();
        return true;
      },
    };
  }

  /** gate-hermes-sse: do not pin to one set of field names — a `type` ending in `delta` is a delta,
   *  one ending in `done`/`completed` is the end. The body is `text ?? delta`. An unknown `type` and a `: keepalive`
   *  comment are dropped silently (A2 §4.4 — keepalives are not raised as events).
   *  `responseId` is the current turn's `X-Hermes-Session-Id`: the id an approval decision is posted back to. */
  async #pump(
    body: ReadableStream<Uint8Array>,
    sessionKey: string,
    turnId: string,
    responseId: string | null,
    sink: EventSink,
  ): Promise<void> {
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let seq = 0;
    let done = false;

    const handleLine = (raw: string): void => {
      const line = raw.trimEnd();
      if (line === "" || line.startsWith(":")) return; // ': keepalive'
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]" || payload === "") return;
      let ev: {
        type?: string;
        text?: string;
        delta?: string;
        id?: string;
        command?: string;
        description?: string;
      };
      try {
        ev = JSON.parse(payload) as typeof ev;
      } catch {
        return; // an unknown shape must not kill the parser (same principle as the claude-code.ts stream-json parser)
      }
      const type = ev.type ?? "";
      if (type.endsWith("approval.requested") || type.endsWith("approval_request")) {
        // US-C06: the suffix rule mirrors the delta/done matcher above, because the real event name is S-A2-5's
        // to pin. An approval event carries `id` + `command`; without both it is not one, and is dropped.
        const id = typeof ev.id === "string" ? ev.id : "";
        const command = typeof ev.command === "string" ? ev.command : "";
        if (id === "" || command === "") return;
        // A2-D9: a host whose TOML has not opted in is still Phase B, where §4.4 says approvals cannot arise —
        // and the endpoint below is S-A2-5's to confirm. So a read-only host reports the event and acts on
        // nothing, keeping the flag-off invariant "no pending_approvals arise from Hermes" at this layer too.
        if (this.cfg.delegation !== true) {
          sink.raw(`[hermes] ignored an approval event on a read-only host: ${command}`);
          return;
        }
        void (async (): Promise<void> => {
          // Off the read loop: a human decision takes minutes, and the SSE stream must keep draining meanwhile.
          try {
            const answer = await sink.approval({
              // A2-D10: the runtime's request is promoted to pending_approvals — the bridge never decides.
              action: "delegate",
              args: { command },
              description:
                typeof ev.description === "string" && ev.description !== ""
                  ? ev.description
                  : `Hermes requests approval: ${command}`,
              // The reply endpoint expresses approve/deny only, so no edit/respond is offered.
              config: {
                allow_accept: true,
                allow_edit: false,
                allow_respond: false,
                allow_ignore: true,
              },
              risk: "normal",
            });
            if (responseId === null) return; // no response id to address the decision to
            const reply: Record<string, unknown> = {
              decision: answer.decision === "accept" ? "approve" : "deny",
            };
            const note = answer.decided_args?.note;
            if (typeof note === "string") reply.note = note;
            const ack = await fetchFn(`${this.cfg.baseUrl}/v1/responses/${responseId}/approval`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${this.cfg.token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(reply),
            });
            if (!ack.ok) sink.raw(`[hermes] approval POST failed: ${ack.status}`);
          } catch (e) {
            // `raw` is the bridge's channel for what it could not classify (claude-code.ts reports stderr there).
            // No retry: the decision is already durable in pending_approvals hub-side — a redelivery path is
            // S-A2-5's to design against the real endpoint.
            sink.raw(`[hermes] approval failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        })();
      } else if (type.endsWith("delta")) {
        const chunk = ev.text ?? ev.delta ?? "";
        if (chunk === "") return;
        text += chunk;
        sink.delta({
          session_key: sessionKey,
          turn_id: turnId,
          item_id: turnId,
          seq: seq++,
          text: chunk,
          channel: "output",
        });
      } else if (!done && (type.endsWith("done") || type.endsWith("completed"))) {
        // A Responses-compatible stream may carry two terminal events (`…output_text.done` + `response.completed`),
        // so the turn completion is raised only once.
        done = true;
        sink.itemCompleted({
          session_key: sessionKey,
          turn_id: turnId,
          item_id: turnId,
          kind: "agent_turn",
          body: text,
          status: "ok",
          meta: {},
        });
        sink.turnCompleted({
          session_key: sessionKey,
          turn_id: turnId,
          status: "ok",
          usage: { cost_usd: null, duration_ms: 0, num_turns: 1 },
        });
      }
    };

    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
    handleLine(buf); // the final line, ending without a newline, is not dropped either
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return await h.cancel(reason);
  }

  async close(): Promise<void> {
    /* an HTTP client has no resident resource to close (A2 §4.4 — no process is spawned) */
  }
}
