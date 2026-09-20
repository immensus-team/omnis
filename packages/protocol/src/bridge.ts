import { z } from "zod";
import { HostId, RuntimeKind } from "./adapter.js";

// 계약 §3.5(브리지 프로토콜, A2 §1·§3)를 그대로 옮긴 것. 이 파일의 오너는 US-A16
// (2026-09-20-phase-a-agent-bridge.md Task 1·3·4)이고, US-A10의 WS /bridge 서버가
// 먼저 필요해서 계약 본문만 선행 이식했다. US-A16 머지 시 이 파일이 기준이다.

/** A2 §7.1. profile은 origin과 purpose에서만 결정되고 프롬프트로 바뀌지 않는다. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

/** capabilities 자기기술 (A2 §1.2) */
export const RuntimeCapabilities = z.object({
  resume: z.boolean(),
  cross_project_resume: z.boolean(),
  stream_deltas: z.boolean(),
  reasoning_stream: z.boolean(),
  tool_calls: z.boolean(),
  approvals: z.enum(["native", "hook", "none"]),
  cancel: z.boolean(),
  models: z.array(z.string()),
  features: z.array(z.string()), // 런타임 원문 통과
});
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilities>;

export const AgentRuntime = z.object({
  id: z.string().uuid(),
  runtime: RuntimeKind,
  host: HostId,
  version: z.string(),
  capabilities: RuntimeCapabilities,
  transport: z.enum(["process", "http"]),
  binary_path: z.string().nullable(),
  allowed_roots: z.array(z.string()),
  base_url: z.string().nullable(),
  state: RuntimeState,
  last_health_at: z.string().datetime(),
});
export type AgentRuntime = z.infer<typeof AgentRuntime>;

export const PROTOCOL_VERSION = "2026-09-20" as const;
export const META_KEYS = {
  protocolVersion: "ai.omnis/protocolVersion",
  traceId: "ai.omnis/traceId",
  origin: "ai.omnis/origin",
} as const;

/** hub → bridge 요청 (A2 §3.2) */
export const HUB_METHODS = [
  "bridge/discover",
  "session.create",
  "session.resume",
  "turn.start",
  "turn.cancel",
  "session.read_summary",
  "delegate.run",
  "session.close",
  "ingest.scan",
  "ingest.read",
] as const;
/** bridge → hub (A2 §3.3). approval.requested만 요청, 나머지는 알림 */
export const BRIDGE_METHODS = [
  "runtime.registered",
  "session.registered",
  "turn.started",
  "turn.item.started",
  "turn.item.delta",
  "turn.item.completed",
  "turn.completed",
  "approval.requested",
  "health",
] as const;
export type HubMethod = (typeof HUB_METHODS)[number];
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/** JSON-RPC 2.0 표준 코드. A2 §3.4가 omnis 범위를 이 위에 얹는다. */
export const JSONRPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

export const BRIDGE_ERRORS = {
  SESSION_NOT_FOUND: -32001,
  RUNTIME_UNAVAILABLE: -32002,
  CAPABILITY_UNSUPPORTED: -32003,
  TURN_ALREADY_ACTIVE: -32004,
  PATH_NOT_ALLOWED: -32005,
  APPROVAL_REQUIRED: -32006,
  TURN_TIMEOUT: -32007,
  TURN_CANCELLED: -32008,
  RUNTIME_RATE_LIMITED: -32009,
  VERSION_UNSUPPORTED: -32010,
  AUTH_FAILED: -32011,
  BUDGET_EXCEEDED: -32012,
} as const;
export type BridgeErrorCode =
  | (typeof BRIDGE_ERRORS)[keyof typeof BRIDGE_ERRORS]
  | (typeof JSONRPC_ERRORS)[keyof typeof JSONRPC_ERRORS];

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown } {
  if (e instanceof BridgeError) {
    return e.data === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, data: e.data };
  }
  return { code: JSONRPC_ERRORS.INTERNAL, message: e instanceof Error ? e.message : String(e) };
}

export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export const RpcMeta = z
  .object({
    [META_KEYS.protocolVersion]: z.string(),
    [META_KEYS.traceId]: z.string().optional(),
    [META_KEYS.origin]: SessionOrigin.optional(),
  })
  .passthrough();

export function withMeta<P extends Record<string, unknown>>(
  params: P,
  meta?: { traceId?: string; origin?: SessionOrigin },
): P & { _meta: Record<string, string> } {
  const _meta: Record<string, string> = { [META_KEYS.protocolVersion]: PROTOCOL_VERSION };
  if (meta?.traceId !== undefined) _meta[META_KEYS.traceId] = meta.traceId;
  if (meta?.origin !== undefined) _meta[META_KEYS.origin] = meta.origin;
  return { ...params, _meta };
}

/** A2-D3: 버전 불일치는 연결을 끊지 않고 이 요청만 -32010으로 거절한다. */
export function assertProtocolVersion(params: unknown): void {
  const meta = (params as { _meta?: unknown } | null | undefined)?._meta;
  const parsed = RpcMeta.safeParse(meta);
  const version = parsed.success ? parsed.data[META_KEYS.protocolVersion] : undefined;
  if (
    version === undefined ||
    !SUPPORTED_PROTOCOL_VERSIONS.includes(version as typeof PROTOCOL_VERSION)
  ) {
    throw new BridgeError(
      BRIDGE_ERRORS.VERSION_UNSUPPORTED,
      `unsupported protocol version: ${version ?? "<missing>"}`,
      { supported: [...SUPPORTED_PROTOCOL_VERSIONS] },
    );
  }
}
