import { randomUUID } from "node:crypto";
import {
  type AgentRuntime,
  BRIDGE_ERRORS,
  BRIDGE_METHODS,
  BridgeError,
  HUB_METHODS,
  type HostId,
  type HumanInterrupt,
  type HumanResponse,
  JSONRPC_ERRORS,
  PROTOCOL_VERSION,
  type RuntimeCapabilities,
  type RuntimeKind,
  SessionCloseParams,
  SessionCreateParams,
  TurnCancelParams,
  type TurnInput,
  TurnStartParams,
  assertProtocolVersion,
} from "@omnis/protocol";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";

export interface EventSink {
  itemStarted(e: Record<string, unknown>): void;
  delta(e: Record<string, unknown>): void;
  itemCompleted(e: Record<string, unknown>): void;
  turnCompleted(e: Record<string, unknown>): void;
  approval(i: HumanInterrupt): Promise<HumanResponse>;
  raw(line: string): void;
}

export interface TurnHandle {
  turn_id: string;
  cancel(reason: string): Promise<boolean>;
}

export interface RuntimeAdapter {
  kind: RuntimeKind;
  probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }>;
  startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle>;
  cancel(h: TurnHandle, reason: string): Promise<boolean>;
  close(s: SessionRecord): Promise<void>;
}

export interface DispatchDeps {
  registry: SessionRegistry;
  adapters: Map<RuntimeKind, RuntimeAdapter>;
  allowedRoots: Map<RuntimeKind, string[]>;
  runtimeIds: Map<RuntimeKind, string>;
  logger: Logger;
  host: HostId;
  runtimes?: AgentRuntime[];
  sinkFor?: (s: SessionRecord, turnId: string) => EventSink;
  beforeTurn?: (turnId: string) => void;
  afterTurn?: (turnId: string) => void;
}

const PHASE_B_METHODS = new Set(["ingest.scan", "ingest.read"]);

export function createDispatcher(
  deps: DispatchDeps,
): (method: string, params: unknown) => Promise<unknown> {
  const adapterFor = (kind: RuntimeKind): RuntimeAdapter => {
    if (kind === "omnis")
      throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "omnis runtime has no adapter");
    const a = deps.adapters.get(kind);
    if (a === undefined)
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `runtime not configured on this host: ${kind}`,
      );
    return a;
  };

  return async (method: string, params: unknown): Promise<unknown> => {
    assertProtocolVersion(params);
    if (PHASE_B_METHODS.has(method)) {
      throw new BridgeError(
        JSONRPC_ERRORS.METHOD_NOT_FOUND,
        `${method} is Phase B (A7 §7 Phase B 시드 메모)`,
      );
    }
    if (!(HUB_METHODS as readonly string[]).includes(method)) {
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unknown method: ${method}`);
    }

    switch (method) {
      case "bridge/discover":
        return {
          protocolVersions: [PROTOCOL_VERSION],
          methods: [...BRIDGE_METHODS],
          runtimes: deps.runtimes ?? [],
        };

      case "session.create": {
        const p = SessionCreateParams.parse(params);
        const roots = deps.allowedRoots.get(p.runtime) ?? [];
        adapterFor(p.runtime);
        const cwd = assertPathAllowed(p.cwd, roots);
        const runtimeId = deps.runtimeIds.get(p.runtime);
        if (runtimeId === undefined)
          throw new BridgeError(
            BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
            `runtime not registered: ${p.runtime}`,
          );
        deps.registry.create({
          session_key: p.session_key,
          runtime: p.runtime,
          runtime_id: runtimeId,
          cwd,
          purpose: p.purpose,
          origin: p.origin,
          permission_profile: p.permission_profile,
          opened_at: new Date().toISOString(),
        });
        return { session_id: null, thread_id: randomUUID() };
      }

      case "session.resume": {
        const rec = deps.registry.require((params as { session_key: string }).session_key);
        return { session_id: rec.session_id ?? "", restored: rec.session_id !== null };
      }

      case "turn.start": {
        const p = TurnStartParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        if (rec.state === "running")
          throw new BridgeError(
            BRIDGE_ERRORS.TURN_ALREADY_ACTIVE,
            `turn already active: ${p.session_key}`,
          );
        const turnId = `t-${randomUUID().slice(0, 8)}`;
        deps.beforeTurn?.(turnId);
        const sink = deps.sinkFor?.(rec, turnId);
        if (sink === undefined)
          throw new BridgeError(JSONRPC_ERRORS.INTERNAL, "no event sink wired");
        deps.registry.setState(p.session_key, "running", new Date().toISOString());
        await adapterFor(rec.runtime).startTurn(rec, p.input, sink);
        return { turn_id: turnId };
      }

      case "turn.cancel": {
        const p = TurnCancelParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        const cancelled = await adapterFor(rec.runtime).cancel(
          { turn_id: p.turn_id, cancel: async () => true },
          p.reason,
        );
        deps.registry.setState(p.session_key, "idle");
        deps.afterTurn?.(p.turn_id);
        return { cancelled };
      }

      case "session.close": {
        const p = SessionCloseParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        await adapterFor(rec.runtime).close(rec);
        deps.registry.close(p.session_key);
        return { closed: true };
      }

      case "session.read_summary":
        // 요약은 허브가 만든다(A2 §6). 브리지는 생성 경로를 갖지 않는다.
        throw new BridgeError(
          BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
          "session.read_summary is served by the hub, not the bridge",
        );

      case "delegate.run": {
        // A2 §5.1: 허브가 서명한 approval_id 없이는 와이어에서 거절한다. Phase A에는 실행 분기가 없다.
        const approvalId = (params as { approval_id?: unknown }).approval_id;
        if (typeof approvalId !== "string" || approvalId.length === 0) {
          deps.logger.error("delegate.run without approval_id", { host: deps.host });
          throw new BridgeError(
            BRIDGE_ERRORS.APPROVAL_REQUIRED,
            "delegate.run requires a hub-signed approval_id",
          );
        }
        throw new BridgeError(
          BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
          "delegation execution lands with the approval gate (US-A07)",
        );
      }

      default:
        throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unhandled method: ${method}`);
    }
  };
}
