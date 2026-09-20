/** protocol Channel/Item status enum의 리터럴을 미러링(패키지 경계 판정 참고 — @omnis/protocol import 안 함). */
export type UiItemStatus =
  | "received"
  | "read"
  | "draft"
  | "approved"
  | "sent"
  | "failed"
  | "archived";

export type UiChannel =
  | "slack"
  | "gmail"
  | "gcal"
  | "outlook"
  | "telegram"
  | "whatsapp"
  | "kakaotalk"
  | "linkedin"
  | "agent"
  | "system";
