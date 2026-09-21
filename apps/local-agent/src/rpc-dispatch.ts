import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type Adapter,
  type AgentRuntime,
  BRIDGE_ERRORS,
  BRIDGE_METHODS,
  BridgeError,
  HUB_METHODS,
  type HostId,
  type HumanInterrupt,
  type HumanResponse,
  ImportScanParams,
  IngestReadParams,
  IngestScanParams,
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
import { handleCaptureSend } from "./capture.js";
import { runDelegation } from "./delegate.js";
import { scanClaudeProjects } from "./import/claude-jsonl.js";
import { handleIngestRead, handleIngestScan } from "./ingest.js";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";
import type { TurnCap } from "./turn-cap.js";

export interface EventSink {
  itemStarted(e: Record<string, unknown>): void;
  delta(e: Record<string, unknown>): void;
  itemCompleted(e: Record<string, unknown>): void;
  turnStarted(e: Record<string, unknown>): void;
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
  /** The hub bridge token: the hub signs a delegation brief with it, the bridge verifies (A2 §5.1, US-C02). */
  token: string;
  adapters: Map<RuntimeKind, RuntimeAdapter>;
  allowedRoots: Map<RuntimeKind, string[]>;
  runtimeIds: Map<RuntimeKind, string>;
  logger: Logger;
  host: HostId;
  runtimes?: AgentRuntime[];
  sinkFor?: (s: SessionRecord, turnId: string) => EventSink;
  /** US-C12: the capture sidecar's adapters, by channel (`startCapture`'s handle). A host with no
   *  `[[capture]]` block leaves it out and `capture.send` answers RUNTIME_UNAVAILABLE. */
  captureAdapterFor?: (channel: string) => Adapter | undefined;
  beforeTurn?: (turnId: string) => void;
  afterTurn?: (turnId: string) => void;
  turnCap?: TurnCap;
  /** US-C14: where `sessions.import_scan` looks. The defaults are a real host's layout; tests point
   *  `claudeHome` at a fixture tree. */
  claudeHome?: string;
  codexHome?: string;
  /** Secret values this process already holds (the bridge token) — masked out of imported turn text. */
  importSecrets?: string[];
}

/** Same rule as `turn.start`: a host with no sink wired is a bug, and the runtime must not be started for it. */
const missingSink = (): EventSink => {
  throw new BridgeError(JSONRPC_ERRORS.INTERNAL, "no event sink wired");
};

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
        deps.turnCap?.acquire(turnId);
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
        deps.turnCap?.release(p.turn_id);
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
        // The summary is produced by the hub (A2 §6). The bridge has no generation path.
        throw new BridgeError(
          BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
          "session.read_summary is served by the hub, not the bridge",
        );

      // US-B10: A2 §3.2. Reads happen only inside the union of every runtime's allowed_roots — there is
      // no reason to split permissions per runtime (reads are read-only, and a file has no notion of a runtime).
      case "ingest.scan": {
        const p = IngestScanParams.parse(params);
        return handleIngestScan(p, {
          allowedRoots: [...new Set([...deps.allowedRoots.values()].flat())],
          logger: deps.logger,
          skipDisallowedRoots: true,
        });
      }

      case "ingest.read": {
        const p = IngestReadParams.parse(params);
        return handleIngestRead(p, {
          allowedRoots: [...new Set([...deps.allowedRoots.values()].flat())],
          logger: deps.logger,
        });
      }

      // US-C14 (C-D7): read-only and pull-based. The scanner opens nothing but
      // `claudeHome/projects/<dir>/<file>.jsonl`, and keeps only sessions whose cwd is inside the
      // union of this host's allowed_roots — the same boundary `session.create` enforces for turns.
      case "sessions.import_scan": {
        const p = ImportScanParams.parse(params);
        return {
          sessions: await scanClaudeProjects(
            p.since === null ? null : new Date(p.since),
            p.max_sessions,
            {
              claudeHome: deps.claudeHome ?? join(homedir(), ".claude"),
              codexHome: deps.codexHome ?? join(homedir(), ".codex"),
              allowedRoots: [...new Set([...deps.allowedRoots.values()].flat())],
              secrets: deps.importSecrets ?? [],
            },
          ),
        };
      }

      case "capture.send":
        // US-C12: the hub signed this draft with the approval id (A2 §5.1) — handleCaptureSend
        // verifies that before any adapter sees it.
        return handleCaptureSend(params, {
          token: deps.token,
          adapterFor: deps.captureAdapterFor ?? (() => undefined),
        });

      case "delegate.run":
        // A2 §5.1: the trust boundary is the HMAC the hub put over the brief — runDelegation checks it,
        // then the path, and only then starts a runtime.
        return runDelegation(params, {
          ...deps,
          adapterFor,
          sinkFor: deps.sinkFor ?? missingSink,
        });

      default:
        throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unhandled method: ${method}`);
    }
  };
}
