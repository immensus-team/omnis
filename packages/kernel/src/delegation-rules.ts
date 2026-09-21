// US-C04 / C-D5 (A4 §4.4, master §19 Q10). The per-runtime, per-host, per-repo allow rules that
// let a delegation approval skip the human click. One implementation, kernel-owned: the hub's
// delegate executor is the only production caller (packages/agents only *proposes* delegations).
import { resolve } from "node:path";
import { z } from "zod";

/** A4 §4.4: even with an allow rule open, anything over 30 minutes goes through approval. */
export const AUTONOMY_MAX_MINUTES = 30;

/** `repo` must be absolute: `delegationAllowed` resolves the workdir to compare it, and a relative
 *  rule would silently resolve against the hub process's cwd (on the mini that is the omnis repo
 *  root, so a rule reading "omnis" would open every path under it). */
export const DelegationRule = z.object({
  runtime: z.enum(["claude_code", "codex", "claude_ds", "hermes", "omnis"]),
  host: z.enum(["mini", "macbook"]),
  repo: z.string().min(1).startsWith("/"),
});
export type DelegationRuleT = z.infer<typeof DelegationRule>;

/** `settings.value` is jsonb and writable through `PUT /settings/:key`, so a malformed row is
 *  dropped rather than thrown on — one bad row must not stop the others from applying. */
export function parseDelegationRules(v: unknown): DelegationRuleT[] {
  if (!Array.isArray(v)) return [];
  const rules: DelegationRuleT[] = [];
  for (const row of v) {
    const parsed = DelegationRule.safeParse(row);
    if (parsed.success) rules.push(parsed.data);
  }
  return rules;
}

/** Everything a verdict depends on, assembled by the caller from the approval row and its task. */
export interface DelegationFacts {
  rules: DelegationRuleT[];
  hermesEnabled: boolean;
  runtime: string;
  host: string;
  workdir: string | null;
  estMinutes: number | null;
  hasEgress: boolean;
  injectionFlagged: boolean;
  fromInboxItem: boolean;
}

/** `index` is the rule's position in `rules` — the audit row records it as `rule:<index>`. */
export type DelegationVerdict =
  | { allowed: true; index: number }
  | { allowed: false; reason: string };

/** A4 §4.4's guards, then the rule match. The guard order only decides which reason a human reads
 *  when several would block; every guard beats every rule. */
export function delegationAllowed(i: DelegationFacts): DelegationVerdict {
  if (i.runtime === "hermes" && !i.hermesEnabled) {
    return { allowed: false, reason: "hermes disabled" };
  }
  if (i.injectionFlagged) return { allowed: false, reason: "injection flags" };
  if (i.hasEgress) return { allowed: false, reason: "egress" };
  if (i.estMinutes === null) return { allowed: false, reason: "no estimate" };
  if (i.estMinutes > AUTONOMY_MAX_MINUTES) return { allowed: false, reason: "over 30 minutes" };
  // A2-D11: claude_code is the runtime that loads a repo's own hooks and MCP servers, so an
  // inbox-originated brief (one with a source_item_id) on it always waits for a human.
  if (i.runtime === "claude_code" && i.fromInboxItem) {
    return { allowed: false, reason: "inbox-originated claude_code" };
  }
  // No workdir means no way to prove the run stays inside the rule's repo.
  if (i.workdir === null) return { allowed: false, reason: "no matching rule" };
  // Containment, not a prefix: /Users/l/omnis-other is a sibling repo, and "..", "/./" are gone
  // by the time resolve() returns.
  const cwd = resolve(i.workdir);
  const index = i.rules.findIndex(
    (r) =>
      r.runtime === i.runtime &&
      r.host === i.host &&
      (cwd === r.repo || cwd.startsWith(`${r.repo}/`)),
  );
  return index === -1 ? { allowed: false, reason: "no matching rule" } : { allowed: true, index };
}
