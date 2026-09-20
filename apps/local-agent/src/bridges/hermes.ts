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

/** A2 §4.4: 승인은 Phase B에서 발생할 여지가 없다(origin='human'만, 위임 대상 제외, A2-D9).
 *  `resume`/`stream_deltas`는 `09` VERIFIED(session_key/session_id 분리, SSE keepalive). 나머지는
 *  Hermes가 원문으로 자기기술하지 않는 필드라 Phase B 스코프에 맞춰 보수적으로 고정한다. */
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

/** A2 §2.1: session_key_header가 session_header_mode('hermes_v1' = X-Hermes-Session-Key)와
 *  다르면 이 런타임을 degraded로 등록하고 세션을 열지 않는다 — probe()를 부르는 쪽(브리지 기동 코드,
 *  이 플랜 밖)이 이 에러를 잡아 AgentRuntime.state='degraded'로 내린다. */
export class HermesSessionHeaderMismatchError extends Error {
  constructor(readonly got: string) {
    super(
      `Hermes GET /v1/capabilities returned session_key_header='${got}', expected 'X-Hermes-Session-Key' (A2 §2.1)`,
    );
    this.name = "HermesSessionHeaderMismatchError";
  }
}

const EXPECTED_SESSION_KEY_HEADER = "X-Hermes-Session-Key";

/** A2-D9: 프로세스를 spawn하지 않는 HTTP형 RuntimeAdapter. session_key를
 *  X-Hermes-Session-Key에 1:1로 얹고, 응답의 X-Hermes-Session-Id를 다음 턴의
 *  previous_response_id 체이닝에 쓴다(§4.4 "이 매핑이 1:1이라 어댑터가 제일 얇다"). */
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
    // §4.4: 다음 턴은 이 id로 체인한다(session_key는 그대로, session_id만 갈린다).
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

  /** gate-hermes-sse: 필드명 한 벌에 고정하지 않는다 — `type`이 `delta`로 끝나면 델타,
   *  `done`/`completed`로 끝나면 종료. 본문은 `text ?? delta`. 모르는 `type`과 `: keepalive`
   *  주석은 조용히 버린다(A2 §4.4 — keepalive는 이벤트로 올리지 않는다). */
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
        return; // 미지 형식이 파서를 죽이지 않는다(claude-code.ts stream-json 파서와 동일 원칙)
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
        // Responses 호환 스트림은 종료 이벤트를 둘(`…output_text.done` + `response.completed`)
        // 보낼 수 있다 — 턴 종료는 한 번만 올린다.
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
    handleLine(buf); // 개행 없이 끝난 마지막 줄도 흘리지 않는다
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return await h.cancel(reason);
  }

  async close(): Promise<void> {
    /* HTTP 클라이언트라 닫을 상주 자원이 없다(A2 §4.4 — 프로세스를 spawn하지 않는다) */
  }
}
