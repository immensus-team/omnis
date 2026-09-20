/** 계약 §5. append-only, 모든 egress가 반드시 경유한다. 구현은 Task 21. */
export interface AuditEntry {
  actor: string; // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string; // 'item.sent' | 'approval.decided' | 'kill_switch.set' ...
  target_table: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  approval_id?: string;
}

export interface Audit {
  record(e: AuditEntry): Promise<void>;
}
