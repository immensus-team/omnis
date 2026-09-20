import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, normalizeHubUrl } from "../src/config.js";

const TOML = `
host = "mini"
hub_url = "ws://127.0.0.1:8787/bridge"
token_keychain_item = "omnis.bridge.token.mini"

[[runtime]]
kind = "codex"
binary = "/opt/homebrew/bin/codex"
pinned_version = "rust-v0.155.1"
allowed_roots = ["/Users/logankim/dev"]

[[runtime]]
kind = "hermes"
base_url = "http://127.0.0.1:8642"
token_keychain_item = "omnis.hermes.api_key.mini"
session_header_mode = "hermes_v1"
`;

const base = { argv: [], env: {} as NodeJS.ProcessEnv, tomlText: TOML };

describe("loadConfig precedence (A2-D15)", () => {
  it("uses TOML when neither CLI nor env is present", () => {
    const r = loadConfig(base);
    expect(r.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(r.provenance.hub_url).toBe("toml");
  });

  it("lets env beat TOML and CLI beat env", () => {
    const envOnly = loadConfig({ ...base, env: { OMNIS_HUB_URL: "ws://127.0.0.1:9999/bridge" } });
    expect(envOnly.config.hub_url).toBe("ws://127.0.0.1:9999/bridge");
    expect(envOnly.provenance.hub_url).toBe("env");

    const both = loadConfig({
      ...base,
      argv: ["--hub", "http://127.0.0.1:8787"],
      env: { OMNIS_HUB_URL: "ws://127.0.0.1:9999/bridge" },
    });
    expect(both.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(both.provenance.hub_url).toBe("cli");
  });

  it("falls back to the built-in default for the host", () => {
    const r = loadConfig({ argv: ["--host", "mini"], env: {} });
    expect(r.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(r.config.token_keychain_item).toBe("omnis.bridge.token.mini");
    expect(r.provenance.hub_url).toBe("default");
  });

  it("normalises the plist's http base URL into a ws bridge URL (A6 §10.2)", () => {
    expect(normalizeHubUrl("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/bridge");
    expect(normalizeHubUrl("https://omnis-hub.your-tailnet.ts.net/api")).toBe(
      "wss://omnis-hub.your-tailnet.ts.net/api/bridge",
    );
    expect(normalizeHubUrl("ws://127.0.0.1:8787/bridge")).toBe("ws://127.0.0.1:8787/bridge");
  });

  it("filters runtimes with --runtimes but never adds one", () => {
    const r = loadConfig({ ...base, argv: ["--runtimes", "codex"] });
    expect(r.config.runtimes.map((x) => x.kind)).toEqual(["codex"]);
    expect(() => loadConfig({ ...base, argv: ["--runtimes", "claude_code"] })).toThrow(ConfigError);
  });

  it("rejects HTTP fields on a process runtime and vice versa", () => {
    expect(() =>
      loadConfig({
        ...base,
        tomlText: `host="mini"\n[[runtime]]\nkind="codex"\nbinary="/x"\nallowed_roots=["/Users/logankim/dev"]\nbase_url="http://127.0.0.1:8642"\n`,
      }),
    ).toThrow(/base_url/);
    expect(() =>
      loadConfig({
        ...base,
        tomlText: `host="mini"\n[[runtime]]\nkind="hermes"\ntoken_keychain_item="a"\nbinary="/x"\n`,
      }),
    ).toThrow(/binary/);
  });

  it("refuses $HOME or / as an allowed root (A2 §2.1 fail-fast)", () => {
    for (const root of ["/", "/Users/logankim"]) {
      expect(() =>
        loadConfig({
          ...base,
          env: { HOME: "/Users/logankim" },
          tomlText: `host="mini"\n[[runtime]]\nkind="codex"\nbinary="/x"\nallowed_roots=["${root}"]\n`,
        }),
      ).toThrow(ConfigError);
    }
  });

  it("reports the source of every top-level key", () => {
    const r = loadConfig({ ...base, argv: ["--host", "mini"] });
    expect(r.provenance).toEqual({ host: "cli", hub_url: "toml", token_keychain_item: "toml" });
  });
});
