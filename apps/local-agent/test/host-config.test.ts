import { describe, expect, it } from "vitest";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

/** Verify with: `pnpm --filter @omnis/local-agent test`. It asserts both hosts at once, so there is no host flag. */
const HOSTS = ["mini", "macbook"] as const;

describe("host profile", () => {
  it("caps active turns at 4 on both hosts (master §9)", () => {
    expect(hostProfile("mini").maxActiveTurns).toBe(4);
    expect(hostProfile("macbook").maxActiveTurns).toBe(4);
  });

  it("points the mini at loopback and the macbook at the tailnet bridge", () => {
    expect(hostProfile("mini").hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(hostProfile("macbook").hub_url.startsWith("wss://")).toBe(true);
    expect(hostProfile("macbook").hub_url.endsWith(".ts.net/bridge")).toBe(true);
  });

  it("uses the per-host bridge token item name (A2 §2.1)", () => {
    for (const host of HOSTS) {
      expect(hostProfile(host).token_keychain_item).toBe(`omnis.bridge.token.${host}`);
    }
  });

  it("exposes only Codex on the mini in Phase A (Hermes is Phase B)", () => {
    expect(phaseARuntimesFor("mini")).toEqual(["codex"]);
    expect(hostProfile("mini").exposedRuntimes).toEqual(["codex", "hermes"]);
  });

  it("exposes the three process runtimes on the macbook in Phase A", () => {
    expect(phaseARuntimesFor("macbook")).toEqual(["claude_code", "codex", "claude_ds"]);
  });
});
