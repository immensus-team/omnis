import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_ERRORS, BridgeError, type HumanResponse } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { HermesAdapter, parseHermesCapabilities } from "../src/bridges/hermes.js";
import { loadConfig } from "../src/config.js";
import type { EventSink } from "../src/rpc-dispatch.js";
import type { SessionRecord } from "../src/session-registry.js";

const here = new URL(".", import.meta.url).pathname;
const FIXTURE = join(here, "fixtures", "hermes", "approval.sse");
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");
/** The `# provenance:` header is fixture metadata (plan convention) — it is not part of the stream. */
const STREAM_LINES = FIXTURE_TEXT.split("\n").filter((l) => !l.startsWith("#"));

const BASE_URL = "http://127.0.0.1:8642";
const COMMAND = "git push origin main";
const DESCRIPTION = "Push the release commit to origin/main";
const RESPONSE_ID = "resp-7";
const ENDPOINT = `${BASE_URL}/v1/responses/${RESPONSE_ID}/approval`;

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
}

type FetchCall = { url: string; init: RequestInit };

/** Answers `/v1/responses` with the approval fixture and everything else with an empty ok response. */
function recordingFetch(calls: FetchCall[]): typeof fetch {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/responses")) {
      return new Response(sseStream(STREAM_LINES), {
        status: 200,
        headers: { "X-Hermes-Session-Id": RESPONSE_ID },
      });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

function approvalPosts(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.url.endsWith("/approval"));
}

/** Narrowed accessor: keeps `noUncheckedIndexedAccess` from turning every read below into a maybe. */
function firstApprovalPost(calls: FetchCall[]): FetchCall {
  const post = approvalPosts(calls)[0];
  if (post === undefined) throw new Error("no approval POST was made");
  return post;
}

interface SinkHarness {
  sink: EventSink;
  calls: {
    delta: Record<string, unknown>[];
    itemCompleted: Record<string, unknown>[];
    turnCompleted: Record<string, unknown>[];
    approval: Record<string, unknown>[];
    raw: string[];
  };
  /** Resolves the pending `sink.approval` promise (only when the sink was built without `immediate`). */
  decide: (r: HumanResponse) => void;
}

function sinkHarness(immediate?: HumanResponse): SinkHarness {
  const calls: SinkHarness["calls"] = {
    delta: [],
    itemCompleted: [],
    turnCompleted: [],
    approval: [],
    raw: [],
  };
  let release: ((r: HumanResponse) => void) | null = null;
  const sink: EventSink = {
    itemStarted: () => {},
    delta: (e) => {
      calls.delta.push(e);
    },
    itemCompleted: (e) => {
      calls.itemCompleted.push(e);
    },
    turnStarted: () => {},
    turnCompleted: (e) => {
      calls.turnCompleted.push(e);
    },
    approval: (i) => {
      calls.approval.push(i as unknown as Record<string, unknown>);
      if (immediate !== undefined) return Promise.resolve(immediate);
      return new Promise<HumanResponse>((res) => {
        release = res;
      });
    },
    raw: (l) => {
      calls.raw.push(l);
    },
  };
  return {
    sink,
    calls,
    decide: (r) => {
      if (release === null) throw new Error("sink.approval was not waiting for a decision");
      release(r);
    },
  };
}

/** The pump is fire-and-forget (`void`), so tests poll instead of racing a fixed sleep. */
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting for the SSE pump");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function baseSession(origin: SessionRecord["origin"]): SessionRecord {
  return {
    session_key: "agent:hermes:mini:delegation-9f3a1c02",
    session_id: null,
    runtime: "hermes",
    runtime_id: "r-1",
    cwd: "/",
    purpose: "delegation-9f3a1c02",
    origin,
    permission_profile: "observe",
    state: "idle",
    opened_at: "2026-09-22T00:00:00.000Z",
    last_turn_at: null,
  };
}

describe("parseHermesCapabilities() delegation flag (US-C06, C-D6)", () => {
  const raw = { session_key_header: "X-Hermes-Session-Key", models: ["gpt-hermes-1"] };

  it("reports `approvals: 'native'` only when the host sets delegation = true", () => {
    expect(parseHermesCapabilities(raw, true).approvals).toBe("native");
    expect(parseHermesCapabilities(raw, false).approvals).toBe("none");
    expect(parseHermesCapabilities(raw).approvals).toBe("none"); // default is off (A2-D9)
  });
});

describe("HttpRuntimeConfig.delegation parsing (US-C06, C-D6)", () => {
  const toml = (extra: string): string =>
    `host = "mini"\n[[runtime]]\nkind = "hermes"\ntoken_keychain_item = "omnis.hermes.api_key.mini"\n${extra}`;

  it("defaults to false — the TOML flag is the only way in", () => {
    const r = loadConfig({ argv: [], env: {}, tomlText: toml("") });
    expect(r.config.runtimes[0]).toMatchObject({ kind: "hermes", delegation: false });
  });

  it("carries delegation = true from TOML", () => {
    const r = loadConfig({ argv: [], env: {}, tomlText: toml("delegation = true\n") });
    expect(r.config.runtimes[0]).toMatchObject({ kind: "hermes", delegation: true });
  });

  it("rejects a non-boolean delegation value (config is a trust boundary)", () => {
    expect(() => loadConfig({ argv: [], env: {}, tomlText: toml('delegation = "yes"\n') })).toThrow(
      /delegation/,
    );
  });
});

describe("HermesAdapter delegation (US-C06)", () => {
  it("refuses origin:'delegation' when the host has no delegation = true (A2-D9)", async () => {
    const calls: FetchCall[] = [];
    const adapter = new HermesAdapter({
      baseUrl: BASE_URL,
      token: "tok-1",
      fetchFn: recordingFetch(calls), // delegation left unset
    });
    const { sink } = sinkHarness();
    const err = await adapter
      .startTurn(baseSession("delegation"), { text: "do x" }, sink)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED);
    expect(calls).toHaveLength(0); // nothing was sent to Hermes
  });

  it("maps an approval event to sink.approval and posts {decision:'approve'} on 'accept', without stalling the stream", async () => {
    const calls: FetchCall[] = [];
    const harness = sinkHarness(); // the decision stays pending until the test releases it
    const adapter = new HermesAdapter({
      baseUrl: BASE_URL,
      token: "tok-1",
      delegation: true,
      fetchFn: recordingFetch(calls),
    });

    await adapter.startTurn(baseSession("delegation"), { text: "deploy" }, harness.sink);

    // The read loop kept draining while the human approval was still pending (Step 3: awaited off the loop).
    await until(() => harness.calls.turnCompleted.length === 1);
    expect(harness.calls.delta.map((d) => d.text)).toEqual([
      "Checking the deploy script.",
      " Waiting for approval.",
    ]);
    expect(approvalPosts(calls)).toHaveLength(0); // nothing decided yet, nothing posted

    expect(harness.calls.approval).toHaveLength(1);
    expect(harness.calls.approval[0]).toMatchObject({
      action: "delegate",
      args: { command: COMMAND },
      description: DESCRIPTION,
      risk: "normal",
      // The Hermes endpoint can only express approve/deny, so no other decision is offered (A2-D10).
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
    });

    harness.decide({ decision: "accept" });
    await until(() => approvalPosts(calls).length === 1);
    const post = firstApprovalPost(calls);
    expect(post.url).toBe(ENDPOINT);
    expect(post.init.method).toBe("POST");
    expect(JSON.parse(String(post.init.body))).toEqual({ decision: "approve" });
    expect((post.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(harness.calls.raw).toHaveLength(0); // the post succeeded, nothing to report
  });

  it("posts {decision:'deny'} when the human ignores the request", async () => {
    const calls: FetchCall[] = [];
    const harness = sinkHarness({ decision: "ignore" });
    const adapter = new HermesAdapter({
      baseUrl: BASE_URL,
      token: "tok-1",
      delegation: true,
      fetchFn: recordingFetch(calls),
    });

    await adapter.startTurn(baseSession("delegation"), { text: "deploy" }, harness.sink);
    await until(() => approvalPosts(calls).length === 1);
    expect(JSON.parse(String(firstApprovalPost(calls).init.body))).toEqual({ decision: "deny" });
  });

  it("never lets keepalive comments or the ignored tail reach the sink", async () => {
    const raw = readFileSync(FIXTURE, "utf8");
    expect(raw.split("\n").filter((l) => l.startsWith(":"))).toHaveLength(2); // the fixture does carry keepalives

    const calls: FetchCall[] = [];
    const harness = sinkHarness({ decision: "ignore" });
    const adapter = new HermesAdapter({
      baseUrl: BASE_URL,
      token: "tok-1",
      delegation: true,
      fetchFn: recordingFetch(calls),
    });
    await adapter.startTurn(baseSession("delegation"), { text: "deploy" }, harness.sink);
    await until(() => harness.calls.turnCompleted.length === 1);

    expect(harness.calls.delta.map((d) => d.text)).toEqual([
      "Checking the deploy script.",
      " Waiting for approval.",
    ]);
    expect(harness.calls.raw).toEqual([]);
    expect(harness.calls.itemCompleted).toHaveLength(1);
    expect(harness.calls.turnCompleted).toHaveLength(1); // one completion despite the two terminal events
  });
});
