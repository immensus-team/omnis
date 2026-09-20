import { ToolCallBadge, type ToolCallState } from "@omnis/ui";
import { useQuery } from "@rocicorp/zero/react";
import { useMemo } from "react";
import { initZero } from "../zero-client.js";

/** items.tool(jsonb, kind='tool_call'일 때만 값)의 실제 shape(0002_core_inbox.sql:151,
 * packages/kernel/src/zero-schema.ts `tool: json().optional()`) — 계획의 `tool: string | null`은
 * DB 컬럼이 이름 문자열이 아니라 객체({name,args,state,label,icon})라는 사실과 맞지 않아 이 shape로
 * 교정한다(Thread.tsx의 sent_at 편차와 같은 종류: 계획 예시 코드가 실제 zero-schema.ts와 다름). */
export interface SessionToolMeta {
  name: string;
  state?: ToolCallState;
  label?: string;
  icon?: string;
  args?: unknown;
}

export interface SessionQueryItem {
  id: string;
  kind: "agent_turn" | "tool_call" | "system";
  tool: SessionToolMeta | null;
  body: string;
}

/** master §11: send/delete/delegate/calendar_write는 에이전트가 직접 호출 못 한다 —
 *  승인 후 실행 결과는 kind='system' 로그 한 줄로만 나타난다(§9 체크리스트). */
export function isSystemExecutionLog(item: SessionQueryItem): boolean {
  return item.kind === "system";
}

// Inbox.tsx/Thread.tsx(Task 4/5)와 같은 이유로 지연 생성: 모듈 스코프에서 만들면
// isSystemExecutionLog만 import해도 WebSocket이 열린다.
let zeroClient: ReturnType<typeof initZero> | undefined;
function getZero() {
  zeroClient ??= initZero();
  return zeroClient;
}

export function AgentSession({ sessionThreadId }: { sessionThreadId: string }) {
  const zero = useMemo(getZero, []);
  // 편차(계획 step 7 대비, packages/kernel/src/zero-schema.ts 기준): items 컬럼은 camelCase
  // `sentAt`이 아니라 snake_case `sent_at`이다 — Thread.tsx(Task 5)가 같은 이유로 이미 고쳤다.
  const [items] = useQuery(
    zero.query.items
      .where("thread_id", "=", sessionThreadId)
      .where("kind", "IN", ["agent_turn", "tool_call", "system"])
      .orderBy("sent_at", "asc"),
  );
  const typedItems = items as unknown as SessionQueryItem[];

  return (
    <div className="agent-session-screen">
      {typedItems.map((item) => {
        if (isSystemExecutionLog(item)) {
          return (
            <p key={item.id} className="agent-session-screen__system-log">
              {item.body}
            </p>
          );
        }
        if (item.kind === "tool_call" && item.tool) {
          const state: ToolCallState = item.tool.state ?? "loading";
          // exactOptionalPropertyTypes(Global Constraints): `resultSummary?: string`는
          // "생략 가능"이지 "undefined 허용"이 아니라서 `resultSummary={item.body || undefined}`는
          // 타입 에러다(useKeymap US-A29 편차와 같은 계열) — 값이 있을 때만 프롭을 스프레드한다.
          return (
            <ToolCallBadge
              key={item.id}
              tool={item.tool.name}
              state={state}
              {...(item.body ? { resultSummary: item.body } : {})}
            />
          );
        }
        return (
          <p key={item.id} className="agent-session-screen__turn">
            {item.body}
          </p>
        );
      })}
    </div>
  );
}
