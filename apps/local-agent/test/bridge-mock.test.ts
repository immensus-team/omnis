import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMeta } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeAdapter } from "../src/bridges/claude-code.js";
import { mapAppServerEvent } from "../src/bridges/codex.js";
import { createLogger } from "../src/logger.js";
import { Outbox } from "../src/outbox.js";
import { type EventSink, type RuntimeAdapter, createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";
import { FIXTURES, mockSpawn } from "./mock-runtime.js";

interface Captured {
  durable: Record<string, unknown>[];
  deltas: Record<string, unknown>[];
  raw: string[];
}

function capture(): { sink: EventSink; out: Captured } {
  const out: Captured = { durable: [], deltas: [], raw: [] };
  return {
    out,
    sink: {
      itemStarted: (e) => out.durable.push({ ...e, _m: "started" }),
      delta: (e) => out.deltas.push(e),
      itemCompleted: (e) => out.durable.push({ ...e, _m: "completed" }),
      turnCompleted: (e) => out.durable.push({ ...e, _m: "turn.completed" }),
      approval: async () => ({ decision: "accept" as const }),
      raw: (l) => out.raw.push(l),
    },
  };
}

const session = {
  session_key: "agent:claude_code:macbook:inbox-draft",
  session_id: null,
  runtime: "claude_code" as const,
  runtime_id: "9c2d1f4b-2e6a-4d1f-8b0c-1a2b3c4d5e6f",
  cwd: process.cwd(),
  purpose: "inbox:draft",
  origin: "job" as const,
  permission_profile: "observe" as const,
  state: "idle" as const,
  opened_at: "2026-09-20T00:00:00.000Z",
  last_turn_at: null,
};

async function runClaudeFixture(fixture: string): Promise<Captured> {
  const { sink, out } = capture();
  const adapter = new ClaudeCodeAdapter({
    kind: "claude_code",
    binary: "claude",
    defaultModel: "sonnet",
    spawnFn: mockSpawn(fixture),
  });
  await adapter.startTurn(session, { text: "go" }, sink);
  await vi.waitFor(() => expect(out.durable.some((d) => d._m === "turn.completed")).toBe(true), {
    timeout: 4000,
  });
  return out;
}

describe("bridge contract invariants (A2 §8.2)", () => {
  it("1. every started item is closed by a completed item of the same id", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const started = out.durable
      .filter((d) => d._m === "started" && d.item_id !== undefined)
      .map((d) => d.item_id);
    const completed = new Set(
      out.durable.filter((d) => d._m === "completed").map((d) => d.item_id),
    );
    for (const id of started) expect(completed.has(id)).toBe(true);
  });

  it("2. not a single delta reaches the durable sink", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    expect(out.deltas.length).toBeGreaterThan(0);
    expect(out.durable.some((d) => typeof d.seq === "number")).toBe(false);
  });

  it("3. durable writes stay under item count x 2 (A2-D4 regression guard)", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const items = new Set(out.durable.filter((d) => d.item_id !== undefined).map((d) => d.item_id))
      .size;
    expect(out.durable.filter((d) => d.item_id !== undefined).length).toBeLessThanOrEqual(
      items * 2,
    );
  });

  it("4. an unknown event type never kills the parser and lands in cold only", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeUnknownItem);
    expect(out.raw.some((l) => l.includes("some_future_event"))).toBe(true);
    expect(out.durable.some((d) => JSON.stringify(d).includes("some_future_event"))).toBe(false);
  });

  it("5. the hub's sink answers an approval before the runtime hears the decision", async () => {
    // 실제 승인 왕복(런타임 → sink.approval → 허브 approval.requested → HumanResponse)은
    // 아직 프로덕션 경로가 없다: ClaudeCodeAdapter의 승인 표면은 hook(US-A07 게이트)이고,
    // CodexAdapter의 app-server 승인 요청 핸들러는 S-A2-3 스파이크 대기라 어느 어댑터도
    // sink.approval을 부르지 않는다. 그래서 여기서 고정하는 것은 "그 왕복이 탈 배선"이다 —
    // 디스패처가 허브의 sink를 런타임에 그대로 넘기고(다른 sink를 새로 만들지 않고),
    // 런타임이 결정을 보는 시점이 sink가 답한 뒤라는 것. 어댑터가 승인 표면을 갖는 날
    // 아래 asking 스텁을 실 어댑터로 바꾸면 그대로 왕복 테스트가 된다.
    // open question(계획 소유자): 승인 왕복의 어댑터 쪽 구현 오너는 US-A07인가 US-A19인가.
    const { sink } = capture();
    const order: string[] = [];
    const hubSink: EventSink = {
      ...sink,
      approval: async (i) => {
        order.push(`asked:${i.action}`);
        await Promise.resolve();
        order.push("answered");
        return { decision: "accept" as const };
      },
    };

    let handed: EventSink | null = null;
    const asking: RuntimeAdapter = {
      kind: "claude_code",
      probe: async () => {
        throw new Error("probe is not part of this invariant");
      },
      startTurn: async (_s, _input, given) => {
        handed = given;
        const res = await given.approval({
          action: "send",
          args: {},
          description: "reply to Kim",
          config: {
            allow_accept: true,
            allow_edit: true,
            allow_respond: false,
            allow_ignore: true,
          },
          risk: "normal",
        });
        order.push(`runtime:${res.decision}`);
        return { turn_id: "t-approval", cancel: async () => true };
      },
      cancel: async () => true,
      close: async () => {},
    };

    const spawnFn = vi.fn(mockSpawn(FIXTURES.claudeToolCall));
    const dispatch = createDispatcher({
      registry: new SessionRegistry(),
      adapters: new Map([["claude_code", asking]]),
      allowedRoots: new Map([["claude_code", [process.cwd()]]]),
      runtimeIds: new Map([["claude_code", "9c2d1f4b-2e6a-4d1f-8b0c-1a2b3c4d5e6f"]]),
      logger: createLogger("@omnis/local-agent", { sink: () => {} }),
      host: "macbook",
      sinkFor: () => hubSink,
    });
    await dispatch(
      "session.create",
      withMeta({
        session_key: "agent:claude_code:macbook:inbox-draft",
        runtime: "claude_code",
        cwd: process.cwd(),
        purpose: "inbox:draft",
        origin: "human",
        permission_profile: "workspace",
      }),
    );
    await dispatch(
      "turn.start",
      withMeta({ session_key: "agent:claude_code:macbook:inbox-draft", input: { text: "go" } }),
    );

    expect(order).toEqual(["asked:send", "answered", "runtime:accept"]);
    expect(handed).toBe(hubSink); // 디스패처가 허브 sink를 그대로 넘겼다
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("6. a cwd outside allowed_roots never spawns a process", async () => {
    const spawnFn = vi.fn(mockSpawn(FIXTURES.claudeToolCall));
    const dispatch = createDispatcher({
      registry: new SessionRegistry(),
      adapters: new Map([
        [
          "claude_code",
          new ClaudeCodeAdapter({
            kind: "claude_code",
            binary: "claude",
            defaultModel: "sonnet",
            spawnFn: spawnFn as never,
          }),
        ],
      ]),
      allowedRoots: new Map([["claude_code", [process.cwd()]]]),
      runtimeIds: new Map([["claude_code", "9c2d1f4b-2e6a-4d1f-8b0c-1a2b3c4d5e6f"]]),
      logger: createLogger("@omnis/local-agent", { sink: () => {} }),
      host: "macbook",
    });
    await expect(
      dispatch(
        "session.create",
        withMeta({
          session_key: "agent:claude_code:macbook:escape",
          runtime: "claude_code",
          cwd: "/etc",
          purpose: "proj:escape",
          origin: "human",
          permission_profile: "trusted",
        }),
      ),
    ).rejects.toMatchObject({ code: -32005 });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("7. an outbox flush produces no duplicate item_id", async () => {
    const o = new Outbox({ path: join(mkdtempSync(join(tmpdir(), "omnis-ob-")), "outbox.ndjson") });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.item.completed", params: { item_id: "i1" } });
    const sent: string[] = [];
    await o.drain(async (e) => {
      sent.push(`${e.method}:${String(e.params.item_id)}`);
    });
    await o.drain(async (e) => {
      sent.push(`${e.method}:${String(e.params.item_id)}`);
    });
    expect(sent).toEqual(["turn.item.started:i1", "turn.item.completed:i1"]);
  });

  it("8. reassembled deltas match the completed body", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const firstItem = String(out.deltas[0]?.item_id ?? "");
    const joined = out.deltas
      .filter((d) => d.item_id === firstItem)
      .map((d) => String(d.text))
      .join("");
    const completed = out.durable.find((d) => d._m === "completed" && d.item_id === firstItem);
    expect(String(completed?.body ?? "")).toBe(joined);
  });

  it("codex: reasoning deltas never become durable items", () => {
    const ctx = {
      session_key: "agent:codex:mini:proj-omnis",
      turn_id: "t1",
      seq: new Map<string, number>(),
    };
    const emits = mapAppServerEvent(
      "item/reasoning/textDelta",
      { itemId: "r1", delta: "hmm" },
      ctx,
    );
    expect(emits.every((e) => e.method === "turn.item.delta")).toBe(true);
  });
});
