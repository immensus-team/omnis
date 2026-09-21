import type { HostId, RuntimeKind } from "@omnis/protocol";
import { parse as parseToml } from "smol-toml";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type ConfigSource = "cli" | "env" | "toml" | "default";

export interface ProcessRuntimeConfig {
  kind: "claude_code" | "codex" | "claude_ds";
  binary: string;
  allowed_roots: string[];
  pinned_version?: string;
  default_model?: string;
  /** The Gate ⑪ switch (Task 12). When unset, the origin default applies (A2-D11). It joins the contract §8 field list once the gate closes. */
  bare?: boolean;
}
export interface HttpRuntimeConfig {
  kind: "hermes";
  base_url: string;
  token_keychain_item: string;
  session_header_mode: "hermes_v1";
  /** US-C06 (C-D6): the per-host switch that lets this Hermes accept `origin:'delegation'` turns. Off unless the
   *  TOML says `delegation = true` — A2-D9 keeps Hermes read-only until S-A2-5 confirms its approval surface. */
  delegation?: boolean;
}
export type RuntimeConfig = ProcessRuntimeConfig | HttpRuntimeConfig;

/** US-C12: the two capture channels that run on a GUI host and reach the hub over the bridge. */
export type CaptureChannel = "kakaotalk" | "linkedin";

/** One `[[capture]]` block: which channel to capture, and the account row on the hub it feeds
 *  (`accounts.external_id`, A3-D4). The hub resolves the row id from this value, so the string has
 *  to match `accounts.external_id` exactly — a typo drops every batch. */
export interface CaptureConfig {
  channel: CaptureChannel;
  account_external_id: string;
}

export interface LocalAgentConfig {
  host: HostId;
  hub_url: string;
  token_keychain_item: string;
  runtimes: RuntimeConfig[];
  /** Empty unless the TOML declares `[[capture]]` — capture is opt-in per host (C-D3). */
  capture: CaptureConfig[];
}
export interface LoadConfigResult {
  config: LocalAgentConfig;
  provenance: Record<"host" | "hub_url" | "token_keychain_item", ConfigSource>;
}

/** Contract §8. host-config.ts (US-A19b) reuses this table. */
export const HOST_DEFAULTS: Record<HostId, { hub_url: string; token_keychain_item: string }> = {
  mini: { hub_url: "ws://127.0.0.1:8787/bridge", token_keychain_item: "omnis.bridge.token.mini" },
  macbook: {
    // The mini's Tailscale Serve mounts the hub at / verbatim (no prefix strip) — paths map 1:1 onto hub routes.
    hub_url: "wss://your-hub.your-tailnet.ts.net/bridge",
    token_keychain_item: "omnis.bridge.token.macbook",
  },
};

const PROCESS_KINDS = new Set(["claude_code", "codex", "claude_ds"]);
const PROCESS_ONLY_FIELDS = ["binary", "allowed_roots", "pinned_version", "default_model", "bare"];
const HTTP_ONLY_FIELDS = ["base_url", "session_header_mode", "delegation"];

/** The A6 §10 plist passes `--hub http://127.0.0.1:8787`. What the bridge uses is ws(s) + /bridge. */
export function normalizeHubUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol !== "ws:" && u.protocol !== "wss:")
    throw new ConfigError(`unsupported hub scheme: ${u.protocol}`);
  if (!u.pathname.endsWith("/bridge")) u.pathname = `${u.pathname.replace(/\/$/, "")}/bridge`;
  return u.toString().replace(/\/$/, "");
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? undefined : inline.slice(name.length + 3);
}

function pick(
  cli: string | undefined,
  env: string | undefined,
  toml: string | undefined,
  fallback: () => string,
): { value: string; source: ConfigSource } {
  if (cli !== undefined) return { value: cli, source: "cli" };
  if (env !== undefined) return { value: env, source: "env" };
  if (toml !== undefined) return { value: toml, source: "toml" };
  return { value: fallback(), source: "default" };
}

function parseRuntime(raw: Record<string, unknown>, homeDir: string): RuntimeConfig {
  const kind = raw.kind;
  if (typeof kind !== "string") throw new ConfigError("[[runtime]] requires a kind");
  if (PROCESS_KINDS.has(kind)) {
    for (const f of HTTP_ONLY_FIELDS) {
      if (raw[f] !== undefined)
        throw new ConfigError(`[[runtime]] kind='${kind}' must not set ${f}`);
    }
    const binary = raw.binary;
    const roots = raw.allowed_roots;
    if (typeof binary !== "string")
      throw new ConfigError(`[[runtime]] kind='${kind}' requires binary`);
    if (!Array.isArray(roots) || roots.length === 0)
      throw new ConfigError(`[[runtime]] kind='${kind}' requires allowed_roots`);
    const allowed_roots = roots.map(String);
    for (const root of allowed_roots) {
      const norm = root.replace(/\/$/, "");
      if (norm === "" || norm === homeDir.replace(/\/$/, "")) {
        throw new ConfigError(`allowed_roots must not contain $HOME or /: ${root}`);
      }
    }
    const out: ProcessRuntimeConfig = {
      kind: kind as ProcessRuntimeConfig["kind"],
      binary,
      allowed_roots,
    };
    if (typeof raw.pinned_version === "string") out.pinned_version = raw.pinned_version;
    if (typeof raw.default_model === "string") out.default_model = raw.default_model;
    if (typeof raw.bare === "boolean") out.bare = raw.bare; // the Gate ⑪ switch. Without it, Task 12 uses the origin default
    return out;
  }
  if (kind === "hermes") {
    for (const f of PROCESS_ONLY_FIELDS) {
      if (raw[f] !== undefined)
        throw new ConfigError(`[[runtime]] kind='hermes' must not set ${f}`);
    }
    const token = raw.token_keychain_item;
    if (typeof token !== "string")
      throw new ConfigError("[[runtime]] kind='hermes' requires token_keychain_item");
    if (raw.delegation !== undefined && typeof raw.delegation !== "boolean")
      throw new ConfigError("[[runtime]] kind='hermes' delegation must be a boolean");
    return {
      kind: "hermes",
      base_url: typeof raw.base_url === "string" ? raw.base_url : "http://127.0.0.1:8642",
      token_keychain_item: token,
      session_header_mode: "hermes_v1",
      delegation: raw.delegation === true, // default false (C-D6)
    };
  }
  throw new ConfigError(`unknown runtime kind: ${kind}`);
}

/** US-C12. The channel enum is closed on purpose: a `[[capture]]` block is a promise that a hub
 *  relay exists for it, and `captureRelayRegistry` only knows these two. */
const CAPTURE_CHANNELS: readonly string[] = ["kakaotalk", "linkedin"];

function parseCapture(raw: Record<string, unknown>): CaptureConfig {
  const channel = raw.channel;
  if (typeof channel !== "string" || !CAPTURE_CHANNELS.includes(channel))
    throw new ConfigError(`[[capture]] channel must be kakaotalk|linkedin, got ${String(channel)}`);
  const accountExternalId = raw.account_external_id;
  if (typeof accountExternalId !== "string" || accountExternalId.trim() === "")
    throw new ConfigError(`[[capture]] channel='${channel}' requires account_external_id`);
  return { channel: channel as CaptureChannel, account_external_id: accountExternalId };
}

/** Two blocks for one channel would create two capture loops feeding one relay; the hub's intake
 *  drops whichever account the relay is not bound to, so the second block would fail silently. */
function parseCaptureBlocks(toml: Record<string, unknown>): CaptureConfig[] {
  if (toml.capture === undefined) return [];
  if (!Array.isArray(toml.capture))
    throw new ConfigError("capture must be an array of [[capture]] tables");
  const blocks = (toml.capture as Record<string, unknown>[]).map(parseCapture);
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.channel))
      throw new ConfigError(`[[capture]] declares channel '${block.channel}' twice`);
    seen.add(block.channel);
  }
  return blocks;
}

export function loadConfig(input: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  tomlText?: string;
}): LoadConfigResult {
  const toml = (input.tomlText === undefined ? {} : parseToml(input.tomlText)) as Record<
    string,
    unknown
  >;
  const homeDir = input.env.HOME ?? "/Users/logankim";

  const host = pick(
    flag(input.argv, "host"),
    input.env.OMNIS_HOST,
    typeof toml.host === "string" ? toml.host : undefined,
    () => "mini",
  );
  if (host.value !== "mini" && host.value !== "macbook")
    throw new ConfigError(`host must be mini|macbook, got ${host.value}`);
  const hostId = host.value as HostId;
  const defaults = HOST_DEFAULTS[hostId];

  const hubRaw = pick(
    flag(input.argv, "hub"),
    input.env.OMNIS_HUB_URL,
    typeof toml.hub_url === "string" ? toml.hub_url : undefined,
    () => defaults.hub_url,
  );
  const token = pick(
    flag(input.argv, "token-keychain-item"),
    input.env.OMNIS_TOKEN_KEYCHAIN_ITEM,
    typeof toml.token_keychain_item === "string" ? toml.token_keychain_item : undefined,
    () => defaults.token_keychain_item,
  );

  const declared = Array.isArray(toml.runtime)
    ? (toml.runtime as Record<string, unknown>[]).map((r) => parseRuntime(r, homeDir))
    : [];
  const filterCsv = flag(input.argv, "runtimes") ?? input.env.OMNIS_RUNTIMES;
  let runtimes = declared;
  if (filterCsv !== undefined) {
    const wanted = filterCsv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const w of wanted) {
      if (!declared.some((r) => r.kind === w)) {
        throw new ConfigError(
          `--runtimes names '${w}' which has no [[runtime]] block (A2-D15: runtimes are TOML-only)`,
        );
      }
    }
    runtimes = declared.filter((r) => wanted.includes(r.kind as RuntimeKind));
  }

  return {
    config: {
      host: hostId,
      hub_url: normalizeHubUrl(hubRaw.value),
      token_keychain_item: token.value,
      runtimes,
      capture: parseCaptureBlocks(toml),
    },
    provenance: { host: host.source, hub_url: hubRaw.source, token_keychain_item: token.source },
  };
}
