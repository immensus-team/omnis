import type { Channel, Scope, Sensitivity } from "@omnis/protocol";

/** The subset of A3 §2 items that L1 classification reads. This file owns it — contract §6 only records the same field list for reference. */
export interface ItemRow {
  id: string;
  thread_id: string;
  account_id: string;
  channel: Channel; // joined from accounts.channel
  kind: "message" | "email" | "event" | "agent_turn" | "tool_call" | "system";
  scope: Scope;
  sensitivity: Sensitivity;
  author_person_id: string | null;
  author_is_me: boolean;
  subject: string | null;
  body: string;
  sent_at: string;
  /** pgvector literal string ("[0.1,0.2,...]"). null for items the embedding batch has not reached yet. */
  embedding: string | null;
}
