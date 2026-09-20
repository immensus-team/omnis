import { describe, expect, it } from "vitest";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

/** 스토리 검증 명령 `pnpm --filter @omnis/local-agent test -- --host=mini`가 이 값을 고른다. */
const flagHost = process.argv.find((a) => a.startsWith("--host="))?.slice("--host=".length);
const HOST = flagHost === "macbook" ? "macbook" : "mini";

describe(`host profile (${HOST})`, () => {
  it("caps active turns at 4 on both hosts (마스터 §9)", () => {
    expect(hostProfile("mini").maxActiveTurns).toBe(4);
    expect(hostProfile("macbook").maxActiveTurns).toBe(4);
  });

  it("points the mini at loopback and the macbook at the tailnet bridge", () => {
    expect(hostProfile("mini").hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(hostProfile("macbook").hub_url.startsWith("wss://")).toBe(true);
    expect(hostProfile("macbook").hub_url.endsWith("/api/bridge")).toBe(true);
  });

  it("uses the per-host bridge token item name (A2 §2.1)", () => {
    expect(hostProfile(HOST).token_keychain_item).toBe(`omnis.bridge.token.${HOST}`);
  });

  it("exposes only Codex on the mini in Phase A (Hermes is Phase B)", () => {
    expect(phaseARuntimesFor("mini")).toEqual(["codex"]);
    expect(hostProfile("mini").exposedRuntimes).toEqual(["codex", "hermes"]);
  });

  it("exposes the three process runtimes on the macbook in Phase A", () => {
    expect(phaseARuntimesFor("macbook")).toEqual(["claude_code", "codex", "claude_ds"]);
  });
});
