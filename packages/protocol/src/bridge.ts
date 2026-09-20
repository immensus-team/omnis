import { z } from "zod";
import { Attachment, HostId, RuntimeKind, SessionId, SessionKey } from "./adapter.js";
import { HumanInterrupt } from "./approval.js";

/** A2-D3: no initialize handshake. Every request carries this version in params._meta. */
export const PROTOCOL_VERSION = "2026-09-20" as const;

export const META_KEYS = {
  protocolVersion: "ai.omnis/protocolVersion",
  traceId: "ai.omnis/traceId",
  origin: "ai.omnis/origin",
} as const;

/** A2 §7.1. profile is decided only by origin and purpose — a prompt never changes it. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

/** A2 §1.2. features carries the runtime's raw strings through untouched. */
export const RuntimeCapabilities = z.object({
  resume: z.boolean(),
  cross_project_resume: z.boolean(),
  stream_deltas: z.boolean(),
  reasoning_stream: z.boolean(),
  tool_calls: z.boolean(),
  approvals: z.enum(["native", "hook", "none"]),
  cancel: z.boolean(),
  models: z.array(z.string()),
  features: z.array(z.string()),
});
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilities>;

/** A2 §1.1. transport='http' means binary_path=null and allowed_roots=[]. */
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

export const TurnInput = z.object({
  text: z.string(),
  attachments: z.array(Attachment).optional(),
});
export type TurnInput = z.infer<typeof TurnInput>;

// --- hub → bridge (A2 §3.2) ---
export const SessionCreateParams = z.object({
  session_key: SessionKey,
  runtime: RuntimeKind,
  cwd: z.string().min(1),
  purpose: z.string().min(1),
  origin: SessionOrigin,
  permission_profile: PermissionProfile,
  model: z.string().optional(),
});
export const SessionCreateResult = z.object({ session_id: z.null(), thread_id: z.string().uuid() });

export const SessionResumeParams = z.object({ session_key: SessionKey });
export const SessionResumeResult = z.object({ session_id: SessionId, restored: z.boolean() });

export const TurnStartParams = z.object({
  session_key: SessionKey,
  input: TurnInput,
  model: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
});
export const TurnStartResult = z.object({ turn_id: z.string().min(1) });

export const TurnCancelParams = z.object({
  session_key: SessionKey,
  turn_id: z.string().min(1),
  reason: z.string(),
});
export const TurnCancelResult = z.object({ cancelled: z.boolean() });

export const SessionCloseParams = z.object({ session_key: SessionKey, reason: z.string() });
export const SessionCloseResult = z.object({ closed: z.literal(true) });

export const BridgeDiscoverResult = z.object({
  protocolVersions: z.array(z.string()).min(1),
  methods: z.array(z.string()),
  runtimes: z.array(AgentRuntime),
});

/** A2 §5.2. Fixed at 5 fields; a delegation without verify is never created. */
export const DelegationBrief = z
  .object({
    approval_id: z.string().uuid(),
    target: z.object({ runtime: RuntimeKind, host: HostId, cwd: z.string().min(1) }),
    goal: z.string().min(1),
    inputs: z.array(z.string()),
    verify: z.string().min(1),
    output: z.enum(["diff", "file", "report"]),
    output_path: z.string().optional(),
    timeout_ms: z.number().int().positive().default(900_000),
    source_item_id: z.string().uuid().optional(),
  })
  .refine((b) => b.output !== "file" || typeof b.output_path === "string", {
    message: "output_path is required when output='file'",
    path: ["output_path"],
  });

// --- bridge → hub (A2 §3.3) ---
/** reasoning is not an item. kind is only ever these two. */
export const BridgeItemKind = z.enum(["agent_turn", "tool_call"]);
export type BridgeItemKind = z.infer<typeof BridgeItemKind>;

export const SessionRegistered = z.object({
  session_key: SessionKey,
  session_id: SessionId.nullable(),
  runtime_id: z.string().uuid(),
  state: SessionState,
});
export const TurnStarted = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  at: z.string().datetime(),
});

export const ItemStarted = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  item_id: z.string(),
  kind: BridgeItemKind,
  label: z.string(),
  meta: z.record(z.unknown()).default({}),
});
export const ItemDelta = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  item_id: z.string(),
  seq: z.number().int().nonnegative(),
  text: z.string(),
  channel: z.enum(["output", "reasoning"]).default("output"),
});
export const ItemCompleted = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  item_id: z.string(),
  kind: BridgeItemKind,
  body: z.string(),
  status: z.enum(["ok", "failed"]),
  meta: z.record(z.unknown()).default({}),
});

export const TurnUsage = z.object({
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export const TurnCompleted = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  status: z.enum(["ok", "failed", "cancelled"]),
  usage: TurnUsage,
  error: z.object({ code: z.number().int(), message: z.string() }).optional(),
});

export const ApprovalRequestedParams = z.object({
  session_key: SessionKey,
  turn_id: z.string(),
  interrupt: HumanInterrupt,
});

export const HealthNotification = z.object({
  host: HostId,
  runtimes: z.array(
    z.object({ id: z.string().uuid(), state: RuntimeState, load: z.number().int().nonnegative() }),
  ),
  limited: z.boolean().default(false),
  at: z.string().datetime(),
});

/** A2 §6. Raw deltas and verbatim reasoning text never land here (A2-D13). */
export const SessionSummary = z.object({
  session_key: SessionKey,
  runtime: RuntimeKind,
  host: HostId,
  purpose: z.string(),
  state: SessionState,
  opened_at: z.string().datetime(),
  last_turn_at: z.string().datetime().nullable(),
  turn_count: z.number().int().nonnegative(),
  summary: z.string().max(400),
  open_questions: z.array(z.string()),
  artifacts: z.array(
    z.object({ path: z.string(), action: z.enum(["created", "modified", "read"]) }),
  ),
  recent_turns: z
    .array(
      z.object({
        turn_id: z.string(),
        at: z.string().datetime(),
        role: z.enum(["user", "agent"]),
        text: z.string().max(1000),
        tool_calls: z.array(z.object({ label: z.string(), status: z.enum(["ok", "failed"]) })),
      }),
    )
    .max(10),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// --- method list and error codes (A2 §3.2~3.4) ---
/** hub → bridge requests (A2 §3.2) */
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
/** bridge → hub (A2 §3.3). Only approval.requested is a request; the rest are notifications. */
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

/** Standard JSON-RPC 2.0 codes. A2 §3.4 layers the omnis range on top of them. */
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

/** Any situation not in the table folds to -32603 internal (A2 §3.4). */
export function toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown } {
  if (e instanceof BridgeError) {
    return e.data === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, data: e.data };
  }
  return { code: JSONRPC_ERRORS.INTERNAL, message: e instanceof Error ? e.message : String(e) };
}

// --- per-request version negotiation (A2-D3, §3.1) ---
export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export const RpcMeta = z
  .object({
    [META_KEYS.protocolVersion]: z.string(),
    [META_KEYS.traceId]: z.string().optional(),
    [META_KEYS.origin]: SessionOrigin.optional(),
  })
  .passthrough();
export type RpcMeta = z.infer<typeof RpcMeta>;

export function withMeta<P extends Record<string, unknown>>(
  params: P,
  meta?: { traceId?: string; origin?: SessionOrigin },
): P & { _meta: Record<string, string> } {
  const _meta: Record<string, string> = { [META_KEYS.protocolVersion]: PROTOCOL_VERSION };
  if (meta?.traceId !== undefined) _meta[META_KEYS.traceId] = meta.traceId;
  if (meta?.origin !== undefined) _meta[META_KEYS.origin] = meta.origin;
  return { ...params, _meta };
}

/** A2-D3: a mismatch rejects just this request with -32010 instead of dropping the connection. */
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
