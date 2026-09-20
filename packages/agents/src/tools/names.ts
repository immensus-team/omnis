// A4 §1.5. 이 파일은 값이 아니라 "이름"만 가진다 — 구현은 read.ts / propose.ts, 조립은 registry.ts.

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

/** A4 §1.5 마지막 문단: 레지스트리에 이 중 하나라도 등록되면 유닛 테스트가 깨진다.
 *  `archive`가 여기 있는 이유 — 자동 보관은 커널 잡의 SQL 전이지 모델이 부르는 tool이 아니다(A4 §9). */
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
