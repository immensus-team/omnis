import { describe, expect, it } from "vitest";
import { type SessionQueryItem, isSystemExecutionLog } from "../src/screens/AgentSession";

describe("isSystemExecutionLog (A5 §3.3 §9: 제안 vs 실행 로그 시각 구분)", () => {
  it("kind='system' is an execution log line, not a tool badge", () => {
    expect(
      isSystemExecutionLog({
        id: "1",
        kind: "system",
        tool: null,
        body: "✓ Codex에게 위임됨",
      } as SessionQueryItem),
    ).toBe(true);
  });
  it("kind='tool_call' is not (it renders as ToolCallBadge)", () => {
    expect(
      isSystemExecutionLog({
        id: "2",
        kind: "tool_call",
        tool: { name: "read" },
        body: "",
      } as SessionQueryItem),
    ).toBe(false);
  });
});
