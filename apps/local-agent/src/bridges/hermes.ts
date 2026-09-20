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
  fetchFn?: typeof fetch;
  now?: () => Date;
}

export interface HermesCapabilitiesResponse {
  session_key_header: string;
  session_id_header?: string;
  models?: string[];
}

/** A2 §4.4: approvals cannot arise in Phase B (origin='human' only, delegation excluded, A2-D9).
 *  `resume`/`stream_deltas` are VERIFIED by `09` (session_key/session_id split, SSE keepalive). The rest are
 *  fields Hermes does not self-describe verbatim, so they are pinned conservatively to match the Phase B scope. */
export function parseHermesCapabilities(raw: HermesCapabilitiesResponse): RuntimeCapabilities {
  return {
    resume: true,
    cross_project_resume: false,
    stream_deltas: true,
    reasoning_stream: false,
    tool_calls: false,
    approvals: "none",
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
    return { version: "hermes", capabilities: parseHermesCapabilities(body) };
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    if (s.origin !== "human") {
      throw new BridgeError(
        BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
        "Hermes sessions are read-only in Phase B — origin must be 'human' (A2-D9)",
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
    void this.#pump(res.body, s.session_key, turnId, sink);

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
   *  comment are dropped silently (A2 §4.4 — keepalives are not raised as events). */
  async #pump(
    body: ReadableStream<Uint8Array>,
    sessionKey: string,
    turnId: string,
    sink: EventSink,
  ): Promise<void> {
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
      let ev: { type?: string; text?: string; delta?: string };
      try {
        ev = JSON.parse(payload) as typeof ev;
      } catch {
        return; // an unknown shape must not kill the parser (same principle as the claude-code.ts stream-json parser)
      }
      const type = ev.type ?? "";
      if (type.endsWith("delta")) {
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
