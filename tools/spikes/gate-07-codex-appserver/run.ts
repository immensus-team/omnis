import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// Deviation from the plan's literal script (recorded in result.md 비고):
// the plan's regex (/sendUserTurn|newTurn|userTurn/i over $defs *key names*) does not
// match this schema — codex 0.155.1's generated bundle names the turn-start request by
// its wire *method string* ("turn/start"), not a camelCase $defs key. We scan the raw
// schema text for the literal method-enum strings instead. Also: TurnStartParams
// requires a `threadId`, which the plan's script never obtains — we call `thread/start`
// first (as A2 §4.2's "스레드/턴/아이템 3원 구조" requires) and thread that id into `turn/start`.
const schemaDir = new URL("./schema", import.meta.url).pathname;
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
const rawText = schemaFiles.map((f) => readFileSync(`${schemaDir}/${f}`, "utf8")).join("\n");

const threadStartMethod = /"thread\/start"/.test(rawText) ? "thread/start" : undefined;
const turnStartMethod = /"turn\/start"/.test(rawText) ? "turn/start" : undefined;
if (!threadStartMethod || !turnStartMethod) {
  throw new Error(
    `no thread/turn-start method found in generated schema (thread=${threadStartMethod}, turn=${turnStartMethod}) — inspect schema/ by hand`,
  );
}

const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let threadId: string | undefined;
let sawThreadStarted = false;
let sawTurnStarted = false;
let sawItemStarted = false;
let sawItemCompleted = false;
let sawTurnCompleted = false;

function findThreadId(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.threadId === "string") return obj.threadId;
    if (typeof obj.thread_id === "string") return obj.thread_id;
    if (obj.thread && typeof obj.thread === "object" && typeof (obj.thread as Record<string, unknown>).id === "string") {
      return (obj.thread as Record<string, unknown>).id as string;
    }
    for (const v of Object.values(obj)) {
      const found = findThreadId(v);
      if (found) return found;
    }
  }
  return undefined;
}

function send(method: string, params: unknown, id: number) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  console.log(">>", msg.trim());
  child.stdin.write(msg);
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx: number;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    console.log("<<", line);
    if (line.includes("thread/started")) sawThreadStarted = true;
    if (line.includes("turn/started")) sawTurnStarted = true;
    if (line.includes("item/started")) sawItemStarted = true;
    if (line.includes("item/completed")) sawItemCompleted = true;
    if (line.includes("turn/completed") || line.includes("turn.completed")) sawTurnCompleted = true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = parsed as { id?: number; result?: unknown };
    if (msg.id === 2 && msg.result && !threadId) {
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
  const pass = sawThreadStarted && sawTurnStarted && sawItemStarted && sawItemCompleted && sawTurnCompleted;
  console.log(
    `gate7_pass=${pass} (threadStarted=${sawThreadStarted} turnStarted=${sawTurnStarted} itemStarted=${sawItemStarted} itemCompleted=${sawItemCompleted} turnCompleted=${sawTurnCompleted})`,
  );
  process.exit(pass ? 0 : 1);
}, 30000);
