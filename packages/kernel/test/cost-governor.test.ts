import { describe, expect, it } from "vitest";
import { POLICY, costState } from "../src/cost/governor.js";

const cap = 60;
const r = 0.1;

describe("costState (A4 §12.4)", () => {
  it("maps spend to the five states", () => {
    expect(costState({ mtdUsd: 0, capUsd: cap, reserveRatio: r })).toBe("normal");
    expect(costState({ mtdUsd: 35.9, capUsd: cap, reserveRatio: r })).toBe("normal");
    expect(costState({ mtdUsd: 36, capUsd: cap, reserveRatio: r })).toBe("warn");
    expect(costState({ mtdUsd: 48, capUsd: cap, reserveRatio: r })).toBe("degraded");
    expect(costState({ mtdUsd: 54, capUsd: cap, reserveRatio: r })).toBe("reserve_only");
    expect(costState({ mtdUsd: 60, capUsd: cap, reserveRatio: r })).toBe("frozen");
    expect(costState({ mtdUsd: 999, capUsd: cap, reserveRatio: r })).toBe("frozen");
  });

  it("never lets a degraded state break the sensitivity rule (A4-D12)", () => {
    for (const s of ["degraded", "reserve_only"] as const) {
      expect(POLICY[s].allowT2Reserve).toBe(true);
      expect(POLICY[s].draftsVipSensitive).toBe(true);
      expect(POLICY[s].allowT2NonSensitive).toBe(false);
    }
    expect(POLICY.reserve_only.draftsNonVip).toBe(false);
    expect(POLICY.frozen.draftsVipSensitive).toBe(false);
  });

  it("keeps digest cadence in step with the state", () => {
    expect(POLICY.normal.digestCron).toBe("daily");
    expect(POLICY.degraded.digestCron).toBe("alternate");
    expect(POLICY.frozen.digestCron).toBe("off");
  });
});
