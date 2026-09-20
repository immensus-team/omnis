import type { Approvals } from "./approvals.js";
import type { Audit } from "./audit.js";
import type { KillSwitch } from "./kill-switch.js";

declare const egressBrand: unique symbol;
/** Created only inside runEgress. Functions that reach the channel take this token as an
 *  argument, so bypassing the flow is a compile error. */
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

/** The only execution path for irreversible actions (master §7, A7 §1). Do not reorder. */
export async function runEgress<T>(
  deps: EgressDeps,
  spec: EgressSpec,
  fn: (token: EgressToken) => Promise<T>,
): Promise<T> {
  await deps.killSwitch.assertOff();
  await deps.approvals.beginExecution(spec.approvalId); // throws unless state=decided + accept|edit
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
