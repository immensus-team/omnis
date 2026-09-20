// Gate ⑦ — Codex app-server 버전 핀 + 1턴 JSON-RPC 왕복.
//
// 사용법:
//   npx tsx run.ts                      실제 `codex app-server` 자식에 1턴을 보낸다
//   npx tsx run.ts --replay <ndjson>    기록된 로그에서 같은 판정을 재산출한다(네트워크 불필요)
//
// 계획 원문 스크립트에서의 이탈(result.md 비고에 기록):
//  1. turn-start 메서드 탐지: 계획의 정규식(/sendUserTurn|newTurn|userTurn/i over $defs 키)은
//     이 스키마와 맞지 않는다 — codex 0.155.1은 wire 메서드 문자열("thread/start","turn/start")로
//     이름을 노출한다. 스키마 원문에서 그 리터럴을 찾는다.
//  2. TurnStartParams는 `threadId`가 필수라 `thread/start`를 먼저 부른다(A2 §4.2 스레드/턴/아이템 3원 구조).
//  3. 이벤트 판정은 줄 전체 부분문자열이 아니라 `params.item.type`을 파싱해서 한다 —
//     서버는 우리가 보낸 프롬프트를 `item.type="userMessage"`로 **에코**하므로, 생짜 매칭은
//     A2 §4.2의 `item/started (agentMessage)` 행을 증명하지 못한다(에코만 보고 초록불이 켜진다).
//  4. `turn/completed`의 `turn.status`(TurnStatus: completed|interrupted|failed|inProgress)를 읽어
//     pass / degraded를 구분한다 — 사용량 한도 초과로 아무 일도 안 일어난 턴과 모델이 실제로 답한 턴이
//     같은 초록 줄을 찍으면 재실행 계측기로서 쓸모가 없다.
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export interface Observations {
  threadStarted: boolean;
  turnStarted: boolean;
  turnCompleted: boolean;
  turnStatus?: string;
  turnErrorInfo?: string;
  /** `item.type === "userMessage"` — 서버가 되돌려주는 우리 자신의 입력 에코. */
  userItemsStarted: Set<string>;
  userItemsCompleted: Set<string>;
  /** 그 외 모든 item 타입(agentMessage, commandExecution, …) = 에이전트 측 아이템. */
  agentItemsStarted: Set<string>;
  agentItemsCompleted: Set<string>;
  /** JSON-RPC 레벨 에러 응답(= 프로토콜 에러). `method:"error"` 알림은 애플리케이션 레벨이라 별도. */
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

/** 한 줄(로그의 `<< `/`>> ` 접두사 허용)을 파싱해 관측치에 반영한다. JSON이 아니면 무시. */
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
  /** A6 §11.3의 pass 기준: "프로토콜 에러 없이 1턴 완주". */
  protocolRoundtrip: boolean;
  /** A2 §4.2 표의 `item/started (agentMessage)` 행이 실제로 관측됐는가. */
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

/** pass=0, degraded=2(프로토콜은 통과했으나 모델 응답 미관측), fail=1. */
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
