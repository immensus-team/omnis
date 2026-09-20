// Gate ⑦ — Codex app-server version pin + one-turn JSON-RPC roundtrip.
//
// Usage:
//   npx tsx run.ts                      send one turn to a real `codex app-server` child process
//   npx tsx run.ts --replay <ndjson>    recompute the same verdict from a recorded log (no network required)
//
// Deviations from the plan's original script (recorded in the result.md notes):
//  1. turn-start method detection: the plan's regex (/sendUserTurn|newTurn|userTurn/i over the
//     $defs keys) does not match this schema — codex 0.155.1 exposes the names as wire method
//     strings ("thread/start", "turn/start"). So we look for those literals in the raw schema text.
//  2. TurnStartParams requires `threadId`, so we call `thread/start` first (the thread/turn/item
//     three-part structure of A2 §4.2).
//  3. Event detection parses `params.item.type` rather than substring-matching the whole line —
//     the server **echoes** the prompt we sent back as `item.type="userMessage"`, so raw matching
//     cannot prove the A2 §4.2 `item/started (agentMessage)` row (the green light turns on from
//     the echo alone).
//  4. Read `turn.status` of `turn/completed` (TurnStatus: completed|interrupted|failed|inProgress)
//     to distinguish pass from degraded — if a turn where nothing happened because the usage limit
//     was exceeded and a turn where the model actually answered print the same green line, the
//     instrument is useless for reruns.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export interface Observations {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  turnStatus?: string;
  turnErrorInfo?: string;
  /** `item.type === "userMessage"` — the echo of our own input that the server sends back. */
  userItemsStarted: Set<string>;
  userItemsCompleted: Set<string>;
  /** Every other item type (agentMessage, commandExecution, …) = agent-side item. */
  agentItemsStarted: Set<string>;
  agentItemsCompleted: Set<string>;
  /** JSON-RPC-level error response (= protocol error). A `method:"error"` notification is
   * application-level, so it is tracked separately. */
  protocolErrors: string[];
}

export function newObservations(): Observations {
  return {
    threadStarted: false,
    turnStarted: false,
    turnCompleted: false,
    userItemsStarted: new Set(),
    userItemsCompleted: new Set(),
    agentItemsStarted: new Set(),
    agentItemsCompleted: new Set(),
    protocolErrors: [],
  };
}

type Wire = {
  id?: number;
  method?: string;
  error?: { message?: string };
  result?: unknown;
  params?: {
    item?: { type?: string };
    turn?: { status?: string; error?: { codexErrorInfo?: string } };
  };
};

/** Parses one line (allowing the log's `<< `/`>> ` prefixes) and folds it into the observations.
 * Lines that are not JSON are ignored. */
export function observeLine(line: string, obs: Observations): Wire | undefined {
  const text = line.replace(/^\s*(<<|>>)\s*/, "").trim();
  if (!text.startsWith("{")) return undefined;
  let msg: Wire;
  try {
    msg = JSON.parse(text) as Wire;
  } catch {
    return undefined;
  }
  if (msg.id !== undefined && msg.error) {
    obs.protocolErrors.push(msg.error.message ?? "unknown JSON-RPC error");
    return msg;
  }
  const itemType = msg.params?.item?.type;
  switch (msg.method) {
    case "thread/started":
      obs.threadStarted = true;
      break;
    case "turn/started":
      obs.turnStarted = true;
      break;
    case "item/started":
      if (itemType === "userMessage") obs.userItemsStarted.add(itemType);
      else if (itemType) obs.agentItemsStarted.add(itemType);
      break;
    case "item/completed":
      if (itemType === "userMessage") obs.userItemsCompleted.add(itemType);
      else if (itemType) obs.agentItemsCompleted.add(itemType);
      break;
    case "turn/completed":
      obs.turnCompleted = true;
      obs.turnStatus = msg.params?.turn?.status;
      obs.turnErrorInfo = msg.params?.turn?.error?.codexErrorInfo;
      break;
  }
  return msg;
}

export interface Verdict extends Observations {
  /** The pass criterion from A6 §11.3: "one turn completed with no protocol errors". */
  protocolRoundtrip: boolean;
  /** Whether the `item/started (agentMessage)` row of the A2 §4.2 table was actually observed. */
  agentMessageObserved: boolean;
  result: "pass" | "degraded" | "fail";
}

export function verdict(obs: Observations): Verdict {
  const protocolRoundtrip =
    obs.threadStarted && obs.turnStarted && obs.turnCompleted && obs.protocolErrors.length === 0;
  const agentMessageObserved = obs.agentItemsStarted.has("agentMessage") && obs.agentItemsCompleted.has("agentMessage");
  const result: Verdict["result"] = !protocolRoundtrip
    ? "fail"
    : obs.turnStatus === "completed" && agentMessageObserved
      ? "pass"
      : "degraded";
  return { ...obs, protocolRoundtrip, agentMessageObserved, result };
}

export function report(v: Verdict): void {
  console.log(
    [
      `gate7_result=${v.result}`,
      `protocol_roundtrip=${v.protocolRoundtrip}`,
      `turn_status=${v.turnStatus ?? "none"}`,
      v.turnErrorInfo ? `turn_error=${v.turnErrorInfo}` : "turn_error=none",
      `agent_message_observed=${v.agentMessageObserved}`,
      `user_items=[${[...v.userItemsCompleted].join(",")}]`,
      `agent_items=[${[...v.agentItemsCompleted].join(",")}]`,
      `protocol_errors=${v.protocolErrors.length}`,
    ].join(" "),
  );
}

/** pass=0, degraded=2 (protocol passed but no model response observed), fail=1. */
export function exitCodeFor(result: Verdict["result"]): number {
  return result === "pass" ? 0 : result === "degraded" ? 2 : 1;
}

function replay(path: string): never {
  const obs = newObservations();
  for (const line of readFileSync(path, "utf8").split("\n")) observeLine(line, obs);
  const v = verdict(obs);
  report(v);
  process.exit(exitCodeFor(v.result));
}

function live(): void {
  const schemaDir = new URL("./schema", import.meta.url).pathname;
  const rawText = readdirSync(schemaDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readFileSync(`${schemaDir}/${f}`, "utf8"))
    .join("\n");
  const threadStartMethod = /"thread\/start"/.test(rawText) ? "thread/start" : undefined;
  const turnStartMethod = /"turn\/start"/.test(rawText) ? "turn/start" : undefined;
  if (!threadStartMethod || !turnStartMethod) {
    throw new Error(
      `no thread/turn-start method found in generated schema (thread=${threadStartMethod}, turn=${turnStartMethod}) — inspect schema/ by hand`,
    );
  }

  const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
  const obs = newObservations();
  let buf = "";
  let threadId: string | undefined;

  function send(method: string, params: unknown, id: number) {
    const msg = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    console.log(">>", msg.trim());
    child.stdin.write(msg);
  }

  function findThreadId(value: unknown): string | undefined {
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.threadId === "string") return obj.threadId;
      if (typeof obj.thread_id === "string") return obj.thread_id;
      for (const v of Object.values(obj)) {
        const found = findThreadId(v);
        if (found) return found;
      }
      if (typeof obj.id === "string") return obj.id;
    }
    return undefined;
  }

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      console.log("<<", line);
      const msg = observeLine(line, obs);
      if (msg?.id === 2 && msg.result && !threadId) {
        threadId = findThreadId(msg.result);
        console.log("-- extracted threadId:", threadId);
        send(turnStartMethod, { threadId, input: [{ type: "text", text: "reply with exactly the word: pong" }] }, 3);
      }
    }
  });

  send("initialize", { clientInfo: { name: "omnis-spike-gate-07", version: "0.0.1" } }, 1);
  setTimeout(() => send(threadStartMethod, {}, 2), 1000);
  setTimeout(() => {
    child.kill();
    const v = verdict(obs);
    report(v);
    process.exit(exitCodeFor(v.result));
  }, 30000);
}

const [flag, arg] = process.argv.slice(2);
if (flag === "--replay") {
  if (!arg) throw new Error("usage: tsx run.ts --replay <ndjson log>");
  replay(arg);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  live();
}
