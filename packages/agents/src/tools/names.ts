// A4 §1.5. This file holds names only, not values — the implementations live in read.ts / propose.ts, the assembly in registry.ts.

export type ToolName =
  | "read_thread"
  | "search_memory"
  | "read_person"
  | "read_entity"
  | "read_calendar"
  | "read_tasks"
  | "read_session"
  | "propose_label"
  | "propose_draft"
  | "propose_task"
  | "propose_delegation"
  | "propose_route"
  | "propose_self_model_patch";

export const TOOL_NAMES: readonly ToolName[] = [
  "read_thread",
  "search_memory",
  "read_person",
  "read_entity",
  "read_calendar",
  "read_tasks",
  "read_session",
  "propose_label",
  "propose_draft",
  "propose_task",
  "propose_delegation",
  "propose_route",
  "propose_self_model_patch",
] as const;

/** A4 §1.5, last paragraph: a unit test fails if even one of these is registered in the registry.
 *  Why `archive` is here — auto-archive is a SQL transition in a kernel job, not a tool the model calls (A4 §9). */
export const PHANTOM_TOOLS: readonly string[] = [
  "send_message",
  "send_email",
  "reply",
  "delete_item",
  "archive",
  "calendar_create",
  "calendar_update",
  "run_agent",
  "exec",
  "read_file",
  "http_fetch",
  "read_secret",
] as const;
