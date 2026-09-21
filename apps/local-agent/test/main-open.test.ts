import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleHubOpen } from "../src/main.js";
import { Outbox } from "../src/outbox.js";
import type { BuiltRuntime } from "../src/runtimes.js";

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
const built: BuiltRuntime[] = [
  {
    kind: "codex",
    adapter: {
      kind: "codex",
      probe: () => Promise.resolve({ version: "v", capabilities: caps }),
      startTurn: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
    },
    allowedRoots: ["/r"],
    version: "v",
    capabilities: caps,
    state: "online",
    transport: "process",
  },
];

const paths: string[] = [];
afterEach(() => {
  for (const p of paths.splice(0)) rmSync(p, { force: true });
  vi.clearAllMocks();
});

function outboxWith(entries: number): Outbox {
  const path = join(tmpdir(), `omnis-open-${randomUUID()}.ndjson`);
  paths.push(path);
  const outbox = new Outbox({ path });
  for (let i = 0; i < entries; i++) {
    outbox.append({ method: "health", params: { runtime: "codex", state: "online", n: i } });
  }
  return outbox;
}

describe("handleHubOpen", () => {
  it("fills runtimeIds from the ids the hub returned", async () => {
    const runtimeIds = new Map<"codex", string>();
    const notify = vi.fn();
    await handleHubOpen({
      client: {
        request: vi.fn().mockResolvedValue({ runtime_id: "11111111-1111-4111-8111-111111111111" }),
        notify,
      },
      host: "macbook",
      built,
      runtimeIds,
      outbox: outboxWith(1),
      logger,
    });
    expect(runtimeIds.get("codex")).toBe("11111111-1111-4111-8111-111111111111");
    expect(notify).toHaveBeenCalledOnce();
  });

  // HubClient fires onOpen fire-and-forget, so a rejection here is an unhandled rejection that kills
  // the process: a flaky hub would crash-loop the agent on every reconnect.
  it("never rejects when the hub refuses runtime.registered, and still drains the outbox", async () => {
    const runtimeIds = new Map<"codex", string>();
    const outbox = outboxWith(2);
    const notify = vi.fn();
    await handleHubOpen({
      client: { request: vi.fn().mockRejectedValue(new Error("hub is down")), notify },
      host: "macbook",
      built,
      runtimeIds,
      outbox,
      logger,
    });
    expect(logger.error).toHaveBeenCalledWith(
      "runtime registration failed; retrying on next connect",
      expect.objectContaining({ err: "hub is down" }),
    );
    expect(outbox.length()).toBe(0);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("never rejects when the drain itself fails, and keeps the unsent entries", async () => {
    const outbox = outboxWith(2);
    const notify = vi.fn(() => {
      throw new Error("hub socket is not open");
    });
    await handleHubOpen({
      client: { request: vi.fn().mockResolvedValue({ runtime_id: randomUUID() }), notify },
      host: "macbook",
      built,
      runtimeIds: new Map(),
      outbox,
      logger,
    });
    expect(logger.error).toHaveBeenCalledWith(
      "outbox drain failed; entries kept for the next connect",
      expect.objectContaining({ err: "hub socket is not open" }),
    );
    expect(outbox.length()).toBe(2);
  });
});
