// US-C04 / C-D5: which delegations an open allow rule may run without a human click.
// This file also carries the guard coverage that used to live in
// packages/agents/test/integration/delegate-loop.test.ts's `autonomyAllows` block: the
// implementation moved to the kernel (the agents package may not import @omnis/kernel,
// biome.jsonc contract §1), so the assertions moved with it.
import { describe, expect, it } from "vitest";
import {
  AUTONOMY_MAX_MINUTES,
  delegationAllowed,
  parseDelegationRules,
} from "../src/delegation-rules.js";

const rules = parseDelegationRules([
  { runtime: "claude_ds", host: "macbook", repo: "/Users/l/omnis" },
  { junk: 1 },
]);
const base = {
  rules,
  hermesEnabled: false,
  runtime: "claude_ds",
  host: "macbook",
  workdir: "/Users/l/omnis/apps",
  estMinutes: 10,
  hasEgress: false,
  injectionFlagged: false,
  fromInboxItem: false,
};

describe("parseDelegationRules", () => {
  it("keeps the well-formed rows and drops the rest", () => {
    expect(rules).toEqual([{ runtime: "claude_ds", host: "macbook", repo: "/Users/l/omnis" }]);
  });

  it("returns an empty list for anything that is not an array", () => {
    for (const junk of [null, undefined, 42, "claude_ds", { runtime: "claude_ds" }]) {
      expect(parseDelegationRules(junk)).toEqual([]);
    }
  });

  it("drops a rule whose repo is not an absolute path", () => {
    // A relative repo would resolve against the hub's cwd, which is the omnis repo root on the
    // mini — a rule like "omnis" would then silently open every path under it.
    expect(parseDelegationRules([{ runtime: "omnis", host: "mini", repo: "omnis" }])).toEqual([]);
    expect(parseDelegationRules([{ runtime: "omnis", host: "mini", repo: "" }])).toEqual([]);
  });
});

describe("delegationAllowed (A4 §4.4, C-D5)", () => {
  it.each([
    [{}, { allowed: true, index: 0 }],
    // Prefix is not containment: /Users/l/omnis-other is a sibling repo, not inside the rule.
    [{ workdir: "/Users/l/omnis-other" }, { allowed: false, reason: "no matching rule" }],
    [{ workdir: "/Users/l/omnis/../secrets" }, { allowed: false, reason: "no matching rule" }],
    [{ estMinutes: AUTONOMY_MAX_MINUTES + 1 }, { allowed: false, reason: "over 30 minutes" }],
    [{ estMinutes: null }, { allowed: false, reason: "no estimate" }],
    [{ hasEgress: true }, { allowed: false, reason: "egress" }],
    [{ injectionFlagged: true }, { allowed: false, reason: "injection flags" }],
    [{ host: "mini" }, { allowed: false, reason: "no matching rule" }],
    [{ runtime: "hermes" }, { allowed: false, reason: "hermes disabled" }],
  ])("%o → %o", (patch, want) => {
    expect(delegationAllowed({ ...base, ...patch })).toEqual(want);
  });

  it("claude_code from an inbox item always needs a human (A2-D11)", () => {
    const r = parseDelegationRules([
      { runtime: "claude_code", host: "macbook", repo: "/Users/l/omnis" },
    ]);
    expect(
      delegationAllowed({ ...base, rules: r, runtime: "claude_code", fromInboxItem: true }),
    ).toEqual({ allowed: false, reason: "inbox-originated claude_code" });
  });

  it("reports the index of the matching rule, not the first rule", () => {
    const r = parseDelegationRules([
      { runtime: "codex", host: "macbook", repo: "/Users/l/omnis" },
      { runtime: "claude_ds", host: "macbook", repo: "/Users/l/omnis" },
    ]);
    expect(delegationAllowed({ ...base, rules: r })).toEqual({ allowed: true, index: 1 });
  });

  it("rules default to empty and nothing is allowed", () => {
    expect(delegationAllowed({ ...base, rules: [] }).allowed).toBe(false);
  });

  it("a null workdir never matches a rule", () => {
    expect(delegationAllowed({ ...base, workdir: null })).toEqual({
      allowed: false,
      reason: "no matching rule",
    });
  });

  it("allows hermes only when the delegation flag is on and a rule covers it", () => {
    const r = parseDelegationRules([
      { runtime: "hermes", host: "macbook", repo: "/Users/l/omnis" },
    ]);
    const facts = { ...base, rules: r, runtime: "hermes", hermesEnabled: true };
    expect(delegationAllowed(facts)).toEqual({ allowed: true, index: 0 });
    expect(delegationAllowed({ ...facts, hermesEnabled: false })).toEqual({
      allowed: false,
      reason: "hermes disabled",
    });
  });

  it("guards beat a matching rule", () => {
    // The rule matches every fact below; only the guard decides.
    const guarded = [
      { estMinutes: 31 },
      { estMinutes: null },
      { hasEgress: true },
      { injectionFlagged: true },
    ];
    for (const patch of guarded) {
      expect(delegationAllowed({ ...base, ...patch }).allowed).toBe(false);
    }
  });
});
