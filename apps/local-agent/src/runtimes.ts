// A2 §2.1: the [[runtime]] blocks are the only source of runtimes. A runtime that cannot probe is still
// registered (as degraded) so the hub can show it and routing can skip it; one that cannot read its
// secret is left out entirely, because it could never run a turn.
import { spawn } from "node:child_process";
import {
  type HostId,
  type RuntimeCapabilities,
  type RuntimeKind,
  RuntimeRegisteredResult,
  type RuntimeState,
} from "@omnis/protocol";
import { ClaudeCodeAdapter, createClaudeDsAdapter } from "./bridges/claude-code.js";
import { CODEX_CAPABILITIES, probeCodexVersion } from "./bridges/codex-probe.js";
import { CodexAdapter } from "./bridges/codex.js";
import { HermesAdapter } from "./bridges/hermes.js";
import type { RuntimeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { RuntimeAdapter } from "./rpc-dispatch.js";

export interface BuiltRuntime {
  kind: RuntimeKind;
  adapter: RuntimeAdapter;
  allowedRoots: string[];
  version: string;
  capabilities: RuntimeCapabilities;
  state: RuntimeState;
  transport: "process" | "http";
}
export interface RuntimeFactoryDeps {
  readSecret(item: string): Promise<string>;
  logger: Logger;
  make?: (c: RuntimeConfig, secret: string | null) => RuntimeAdapter;
}

const DEEPSEEK_KEY_ITEM = "deepseek-api"; // A2 §4.3

function codexVersionLine(binary: string): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn(binary, ["--version"]);
    let out = "";
    c.stdout.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    c.on("error", () => resolve(""));
    c.on("close", () => resolve(out.trim()));
  });
}

async function defaultMake(c: RuntimeConfig, secret: string | null): Promise<RuntimeAdapter> {
  switch (c.kind) {
    case "claude_code":
      return new ClaudeCodeAdapter({
        kind: "claude_code",
        binary: c.binary,
        defaultModel: c.default_model ?? "sonnet",
        ...(c.bare === undefined ? {} : { bare: c.bare }),
      });
    case "claude_ds":
      return createClaudeDsAdapter({
        binary: c.binary,
        apiKey: secret ?? "",
        ...(c.default_model ? { model: c.default_model } : {}),
      });
    case "codex": {
      const p = probeCodexVersion(await codexVersionLine(c.binary), c.pinned_version);
      return new CodexAdapter({
        binary: c.binary,
        capabilities: p.capabilities ?? CODEX_CAPABILITIES,
        version: p.version,
      });
    }
    case "hermes":
      return new HermesAdapter({ baseUrl: c.base_url, token: secret ?? "" });
  }
}

function secretItem(c: RuntimeConfig): string | null {
  if (c.kind === "claude_ds") return DEEPSEEK_KEY_ITEM;
  if (c.kind === "hermes") return c.token_keychain_item;
  return null;
}

export async function buildRuntimes(
  cfgs: RuntimeConfig[],
  deps: RuntimeFactoryDeps,
): Promise<BuiltRuntime[]> {
  const out: BuiltRuntime[] = [];
  for (const c of cfgs) {
    let secret: string | null = null;
    const item = secretItem(c);
    if (item !== null) {
      try {
        secret = await deps.readSecret(item);
      } catch {
        // The item name is logged, never the value (A2 §7.2).
        deps.logger.error("runtime skipped: secret unreadable", { runtime: c.kind, item });
        continue;
      }
    }
    const adapter = deps.make ? deps.make(c, secret) : await defaultMake(c, secret);
    const allowedRoots = c.kind === "hermes" ? [] : c.allowed_roots;
    const transport = c.kind === "hermes" ? "http" : "process";
    try {
      const p = await adapter.probe();
      out.push({
        kind: c.kind,
        adapter,
        allowedRoots,
        version: p.version,
        capabilities: p.capabilities,
        state: "online",
        transport,
      });
    } catch (e) {
      deps.logger.warn("runtime probe failed; registering as degraded", {
        runtime: c.kind,
        err: e instanceof Error ? e.message : String(e),
      });
      out.push({
        kind: c.kind,
        adapter,
        allowedRoots,
        version: "unknown",
        capabilities: {
          resume: false,
          cross_project_resume: false,
          stream_deltas: false,
          reasoning_stream: false,
          tool_calls: false,
          approvals: "none",
          cancel: false,
          models: [],
          features: ["probe_failed"],
        },
        state: "degraded",
        transport,
      });
    }
  }
  return out;
}

export async function registerRuntimes(
  client: {
    request(m: "runtime.registered", p: Record<string, unknown>): Promise<unknown>;
  },
  host: HostId,
  built: BuiltRuntime[],
): Promise<Map<RuntimeKind, string>> {
  const ids = new Map<RuntimeKind, string>();
  for (const b of built) {
    const res = RuntimeRegisteredResult.parse(
      await client.request("runtime.registered", {
        runtime: b.kind,
        host,
        version: b.version,
        capabilities: b.capabilities,
        state: b.state,
        display: `${b.kind}@${host}`,
      }),
    );
    ids.set(b.kind, res.runtime_id);
  }
  return ids;
}
