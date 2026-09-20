import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeHubUrl } from "../src/config.js";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

const plist = (host: "mini" | "macbook"): string[] => {
  const xml = readFileSync(
    join(__dirname, "..", "launchagent", `ai.onwordlab.omnis-local-agent.${host}.plist`),
    "utf8",
  );
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? "";
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] as string);
};
const flagValue = (args: string[], name: string): string | undefined =>
  args[args.indexOf(name) + 1];

describe("LaunchAgent plists (A6 §10)", () => {
  it("passes a --hub that normalises to this host's bridge URL", () => {
    for (const host of ["mini", "macbook"] as const) {
      const hub = flagValue(plist(host), "--hub");
      expect(hub).toBeDefined();
      expect(normalizeHubUrl(hub as string)).toBe(hostProfile(host).hub_url);
    }
  });

  it("restricts the mini to the runtimes Phase A actually implements", () => {
    const runtimes = (flagValue(plist("mini"), "--runtimes") ?? "").split(",");
    expect(runtimes).toContain("codex");
    expect(phaseARuntimesFor("mini").every((r) => runtimes.includes(r))).toBe(true);
  });

  it("boots at login and stays alive", () => {
    const xml = readFileSync(
      join(__dirname, "..", "launchagent", "ai.onwordlab.omnis-local-agent.mini.plist"),
      "utf8",
    );
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).not.toContain("LaunchDaemons");
  });
});
