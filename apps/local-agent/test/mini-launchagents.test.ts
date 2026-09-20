import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const OPS_MINI = join(__dirname, "..", "..", "..", "ops", "mini");
const SERVICES = ["hub", "zero-cache", "local-agent"] as const;

const plist = (service: string): string =>
  readFileSync(join(OPS_MINI, `com.omnis.${service}.plist`), "utf8");

const args = (xml: string): string[] => {
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? "";
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] as string);
};

describe("mini LaunchAgents (A6 §1, §10)", () => {
  it("labels each plist after its filename and runs it through the secrets wrapper", () => {
    for (const service of SERVICES) {
      const xml = plist(service);
      expect(xml).toContain(`<key>Label</key><string>com.omnis.${service}</string>`);
      expect(args(xml)).toEqual(["__OMNIS_ROOT__/ops/mini/run.sh", service]);
    }
  });

  it("boots at login, stays alive, and is an Agent — not a Daemon (A6-D10)", () => {
    for (const service of SERVICES) {
      const xml = plist(service);
      expect(xml).toContain("<key>RunAtLoad</key><true/>");
      expect(xml).toContain("<key>KeepAlive</key><true/>");
      expect(xml).not.toContain("LaunchDaemons");
      expect(xml).toContain(`__HOME__/Library/Logs/omnis/${service}.log`);
      expect(xml).toContain(`__HOME__/Library/Logs/omnis/${service}.err.log`);
    }
  });

  it("keeps secrets out of the plists — run.sh sources them from the Keychain", () => {
    for (const service of SERVICES) {
      expect(plist(service)).not.toContain("EnvironmentVariables");
    }
    const run = readFileSync(join(OPS_MINI, "run.sh"), "utf8");
    for (const service of SERVICES) expect(run).toContain(`${service})`);
    expect(run).toContain("ops/mini/env.sh");
    // env.sh is generated and not committed. The example file contains only the Keychain lookups.
    const example = readFileSync(join(OPS_MINI, "env.sh.example"), "utf8");
    expect(example).toContain("security find-generic-password");
    expect(example).not.toMatch(/=\s*["']?[A-Za-z0-9+/]{24,}/);
  });

  // the `--runtimes codex` that run.sh passes dies with a ConfigError unless the TOML has a
  // [[runtime]] block of the same name (A2-D15) — and launchd then spins in a crash loop.
  it("ships a TOML the plist's --runtimes filter can actually resolve", () => {
    const tomlText = readFileSync(join(OPS_MINI, "local-agent.toml.example"), "utf8");
    const { config } = loadConfig({
      argv: ["--host", "mini", "--hub", "http://127.0.0.1:8787", "--runtimes", "codex"],
      env: { HOME: "/Users/vigor" },
      tomlText,
    });
    expect(config.runtimes.map((r) => r.kind)).toEqual(["codex"]);
    expect(config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
  });
});
