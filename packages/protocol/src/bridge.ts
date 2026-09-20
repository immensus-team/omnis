import { z } from "zod";
import { HostId, RuntimeKind } from "./adapter.js";

/** A2-D3: initialize 핸드셰이크 없음. 모든 요청의 params._meta에 이 버전을 싣는다. */
export const PROTOCOL_VERSION = "2026-09-20" as const;

export const META_KEYS = {
  protocolVersion: "ai.omnis/protocolVersion",
  traceId: "ai.omnis/traceId",
  origin: "ai.omnis/origin",
} as const;

/** A2 §7.1. profile은 origin과 purpose에서만 결정되고 프롬프트로 바뀌지 않는다. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

/** A2 §1.2. features는 런타임 원문을 손대지 않고 그대로 싣는다. */
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

/** A2 §1.1. transport='http'면 binary_path=null, allowed_roots=[]. */
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
