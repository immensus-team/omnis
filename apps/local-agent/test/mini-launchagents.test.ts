import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const OPS_MINI = join(__dirname, "..", "..", "..", "ops", "mini");
const SERVICES = ["hub", "zero-cache", "local-agent"] as const;

/** US-C18: the capture sidecars. They are LaunchAgents too, but a different species — see below. */
const CAPTURE_APPS = { kakaotalk: "KakaoTalk", beeper: "Beeper" } as const;

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

  // C-D3: capture is opt-in per host, so the example must ship the blocks commented out. If one of them
  // were live, a mini that copied the example would start a capture loop before its channel has an
  // account row, and preflight's capture probes would stop being skipped (US-C18).
  it("leaves capture off until the channel's live story switches it on", () => {
    const { config } = loadConfig({
      argv: ["--host", "mini", "--hub", "http://127.0.0.1:8787", "--runtimes", "codex"],
      env: { HOME: "/Users/vigor" },
      tomlText: readFileSync(join(OPS_MINI, "local-agent.toml.example"), "utf8"),
    });
    expect(config.capture).toEqual([]);
  });
});

describe("mini capture sidecars (US-C18, A1 §2.6 · §2.8)", () => {
  // The acceptance run does the real parse (`plutil -lint ops/mini/*.plist`), but plutil is macOS-only
  // while CI runs on ubuntu-latest — so this checks the same structure without shelling out: every
  // <key> carries a value element, and the plist declares exactly the keys it means to and no others.
  it("parses — every key carries a value, and the key set is exactly the documented one", () => {
    for (const app of Object.keys(CAPTURE_APPS)) {
      const xml = plist(app);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml.trimEnd().endsWith("</plist>")).toBe(true);
      const keys = [...xml.matchAll(/<key>([^<]*)<\/key>/g)].map((m) => m[1] as string);
      expect(keys).toEqual([
        "Label",
        "ProgramArguments",
        "RunAtLoad",
        "StartInterval",
        "LimitLoadToSessionType",
      ]);
      for (const key of keys) expect(xml).toMatch(new RegExp(`<key>${key}</key>\\s*<\\w+`));
    }
  });

  // `open -g` never steals focus, so there is no KeepAlive here: `open` exits immediately by design and
  // a KeepAlive agent would look like a crash loop. The interval is what re-launches a crashed app.
  it("re-launches the GUI app without stealing focus, in the Aqua session only", () => {
    for (const [app, bundle] of Object.entries(CAPTURE_APPS)) {
      const xml = plist(app);
      expect(xml).toContain(`<key>Label</key><string>com.omnis.${app}</string>`);
      expect(args(xml)).toEqual(["/usr/bin/open", "-g", "-a", bundle]);
      expect(xml).toContain("<key>RunAtLoad</key><true/>");
      expect(xml).toContain("<key>StartInterval</key><integer>300</integer>");
      expect(xml).toContain("<key>LimitLoadToSessionType</key><string>Aqua</string>");
    }
  });

  // 8642 is the mini's Hermes/omh/buzz setup, which omnis must never touch (CLAUDE.md).
  it("never reaches for the mini's Hermes setup", () => {
    for (const app of Object.keys(CAPTURE_APPS)) {
      const xml = plist(app).toLowerCase();
      for (const forbidden of ["8642", "hermes", "omh", "buzz"])
        expect(xml).not.toContain(forbidden);
    }
  });

  // US-C18 ships definitions only. The generic loop bootstraps everything in SERVICES, so the sidecars
  // must stay out of that list — a bootstrap here would start KakaoTalk capture before Phase C is live.
  it("is laid down by install.sh but never bootstrapped by it", () => {
    const install = readFileSync(join(OPS_MINI, "install.sh"), "utf8");
    const lines = install.split("\n");
    const live = lines.filter((line) => !line.trimStart().startsWith("#"));
    for (const app of Object.keys(CAPTURE_APPS)) {
      // the `local-agent.toml` rule: copy only when the file is absent
      expect(
        live.some((line) => line.includes(`com.omnis.${app}.plist`) && line.includes("[ -f")),
      ).toBe(true);
      expect(live.filter((line) => line.includes(app) && line.includes("launchctl"))).toEqual([]);
    }
    const defaults = /SERVICES=\(([^)]*)\)/.exec(install)?.[1] ?? "";
    for (const app of Object.keys(CAPTURE_APPS)) expect(defaults).not.toContain(app);
  });
});
