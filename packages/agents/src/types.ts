import type { Channel, Scope, Sensitivity } from "@omnis/protocol";

/** A3 §2 items 중 L1 분류가 읽는 부분집합. 오너는 이 파일 — 계약 §6은 같은 필드 목록을 참고용으로 기록만 한다. */
export interface ItemRow {
  id: string;
  thread_id: string;
  account_id: string;
  channel: Channel; // accounts.channel 조인값
  kind: "message" | "email" | "event" | "agent_turn" | "tool_call" | "system";
  scope: Scope;
  sensitivity: Sensitivity;
  author_person_id: string | null;
  author_is_me: boolean;
  subject: string | null;
  body: string;
  sent_at: string;
  /** pgvector 리터럴 문자열("[0.1,0.2,...]"). 임베딩 배치가 아직 안 돈 item은 null. */
  embedding: string | null;
}
