import { describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter } from "../src/rpc-dispatch.js";
import { buildRuntimes, registerRuntimes } from "../src/runtimes.js";

const logger = {
  log: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: vi.fn(),
  error: vi.fn(),
};
const caps = {
  resume: true,
  cross_project_resume: false,
  stream_deltas: true,
  reasoning_stream: false,
  tool_calls: true,
  approvals: "native" as const,
  cancel: true,
  models: [],
  features: [],
};
const fake = (kind: RuntimeAdapter["kind"], fail = false): RuntimeAdapter => ({
  kind,
  probe: fail
    ? () => Promise.reject(new Error("binary missing"))
    : () => Promise.resolve({ version: `${kind} 1`, capabilities: caps }),
  startTurn: vi.fn(),
  cancel: vi.fn(),
  close: vi.fn(),
});

describe("buildRuntimes", () => {
  it("builds one adapter per [[runtime]] block and keeps its allowed_roots", async () => {
    const built = await buildRuntimes(
      [
        { kind: "codex", binary: "/bin/codex", allowed_roots: ["/r/a"] },
        {
          kind: "hermes",
          base_url: "http://127.0.0.1:9",
          token_keychain_item: "omnis.hermes.token.macbook",
          session_header_mode: "hermes_v1",
        },
      ],
      { readSecret: async () => "s", logger, make: (c) => fake(c.kind) },
    );
    expect(built.map((b) => [b.kind, b.state, b.transport])).toEqual([
      ["codex", "online", "process"],
      ["hermes", "online", "http"],
    ]);
    expect(built[0]?.allowedRoots).toEqual(["/r/a"]);
    expect(built[1]?.allowedRoots).toEqual([]);
  });
  it("a failed probe registers the runtime as degraded instead of throwing", async () => {
    const built = await buildRuntimes(
      [{ kind: "claude_code", binary: "/nope", allowed_roots: [] }],
      { readSecret: async () => "s", logger, make: (c) => fake(c.kind, true) },
    );
    expect(built[0]?.state).toBe("degraded");
    expect(logger.warn).toHaveBeenCalled();
  });
  it("a secret that cannot be read drops only that runtime", async () => {
    const built = await buildRuntimes(
      [{ kind: "claude_ds", binary: "/bin/claude-ds", allowed_roots: [] }],
      {
        readSecret: async () => {
          throw new Error("locked");
        },
        logger,
        make: (c) => fake(c.kind),
      },
    );
    expect(built).toEqual([]);
  });
});

describe("registerRuntimes", () => {
  it("maps each runtime to the id the hub returned", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ runtime_id: "11111111-1111-4111-8111-111111111111" });
    const ids = await registerRuntimes({ request }, "macbook", [
      {
        kind: "codex",
        adapter: fake("codex"),
        allowedRoots: ["/r"],
        version: "v",
        capabilities: caps,
        state: "online",
        transport: "process",
      },
    ]);
    expect(ids.get("codex")).toBe("11111111-1111-4111-8111-111111111111");
    expect(request).toHaveBeenCalledWith(
      "runtime.registered",
      expect.objectContaining({ runtime: "codex", host: "macbook", state: "online" }),
    );
  });
});
