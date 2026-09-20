import type { Approvals } from "./approvals.js";
import type { Audit } from "./audit.js";
import type { KillSwitch } from "./kill-switch.js";

declare const egressBrand: unique symbol;
/** runEgress 안에서만 만들어진다. 채널로 나가는 함수는 이 토큰을 인자로 요구해 우회를 컴파일 에러로 만든다. */
export type EgressToken = {
  readonly [egressBrand]: "EgressToken";
  readonly approvalId: string;
};

export interface EgressSpec {
  approvalId: string;
  actor: string; // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string; // 'item.sent' | 'calendar.written' | 'item.deleted' ...
  targetTable: string;
  targetId?: string;
}

export interface EgressDeps {
  approvals: Approvals;
  killSwitch: KillSwitch;
  audit: Audit;
}

/** 비가역 행동의 유일한 실행 경로(마스터 §7, A7 §1). 순서를 바꾸지 않는다. */
export async function runEgress<T>(
  deps: EgressDeps,
  spec: EgressSpec,
  fn: (token: EgressToken) => Promise<T>,
): Promise<T> {
  await deps.killSwitch.assertOff();
  await deps.approvals.beginExecution(spec.approvalId); // decided + accept|edit이 아니면 throw
  const token = { approvalId: spec.approvalId } as unknown as EgressToken;
  const targetIdField = spec.targetId !== undefined ? { target_id: spec.targetId } : {};
  try {
    const out = await fn(token);
    await deps.approvals.completeExecution(spec.approvalId);
    await deps.audit.record({
      actor: spec.actor,
      action: spec.action,
      target_table: spec.targetTable,
      ...targetIdField,
      after: { ok: true },
      approval_id: spec.approvalId,
    });
    return out;
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await deps.approvals.failExecution(spec.approvalId, reason);
    await deps.audit.record({
      actor: spec.actor,
      action: spec.action,
      target_table: spec.targetTable,
      ...targetIdField,
      after: { ok: false, reason },
      approval_id: spec.approvalId,
    });
    throw e;
  }
}
