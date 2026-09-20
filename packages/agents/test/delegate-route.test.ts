import { describe, expect, it } from "vitest";
import {
  DELEGATION_DAILY_CAP,
  DELEGATION_THREAD_CAP_24H,
  extractHints,
  pickRuntime,
  routeByRule,
} from "../src/index.js";

const hosts = { mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 0 } };

// Frozen fixtures: every Korean string below is a Korean-language task prompt fed to extractHints /
// routeByRule. They are the inputs the Korean routing regexes (GUI_CHANNEL / ALWAYS_ON / MINUTES /
// HOURS in src/delegate/route.ts) exist to match, so translating them would change routing.
describe("extractHints (A4 §5.2)", () => {
  it("pulls absolute paths, cron words and minutes out of text with regex only", () => {
    const h = extractHints(
      "/Users/logankim/AI-Workspaces/omnis 에서 매일 리포트를 돌려줘. 약 45분 걸림",
    );
    expect(h.needs_paths).toEqual(["/Users/logankim/AI-Workspaces/omnis"]);
    expect(h.needs_always_on).toBe(true);
    expect(h.est_minutes).toBe(45);
    expect(h.repo).toBe("/Users/logankim/AI-Workspaces/omnis");
  });

  it("reads hours when minutes are absent, and null when neither is there", () => {
    expect(extractHints("2시간짜리 배치").est_minutes).toBe(120);
    expect(extractHints("문서 요약").est_minutes).toBe(null);
  });

  it("flags a GUI channel session", () => {
    expect(extractHints("카카오톡으로 답장 보내는 일").needs_channel_session).toBe(true);
    expect(extractHints("LinkedIn 메시지 정리").needs_channel_session).toBe(true);
    expect(extractHints("문서 요약").needs_channel_session).toBe(false);
  });
});

describe("routeByRule (A4 §5.2)", () => {
  it("applies the five rules in order", () => {
    expect(routeByRule(extractHints("/Users/logankim/x 파일 고쳐줘"), hosts)).toMatchObject({
      host: "macbook",
      rule_id: "dr_local_files",
    });
    expect(routeByRule(extractHints("카카오톡 정리"), hosts)).toMatchObject({
      host: "mini",
      rule_id: "dr_gui_session",
    });
    expect(routeByRule({ ...extractHints("긴 작업"), est_minutes: 30 }, hosts)).toMatchObject({
      host: "mini",
      rule_id: "dr_long_batch",
    });
    expect(routeByRule(extractHints("매일 돌려줘"), hosts)).toMatchObject({
      host: "mini",
      rule_id: "dr_always_on",
    });
    expect(
      routeByRule(extractHints("문서 요약"), {
        mini: { lastHeartbeatMs: 0 },
        macbook: { lastHeartbeatMs: 300_000 },
      }),
    ).toMatchObject({ host: "mini", rule_id: "dr_macbook_offline" });
  });

  it("does not treat /Users/Shared as a local-files signal", () => {
    expect(routeByRule(extractHints("/Users/Shared/drop 정리"), hosts)).toBe(null);
  });

  it("returns null when nothing splits it — that is L4's entry point", () => {
    expect(routeByRule(extractHints("문서 요약"), hosts)).toBe(null);
  });

  it("never routes to hermes in Phase B (B-D7)", () => {
    expect(
      pickRuntime({ filesTouched: 5, specClear: false, liveCodexSession: false, isCode: true }),
    ).toBe("claude_code");
    expect(
      pickRuntime({ filesTouched: 1, specClear: true, liveCodexSession: false, isCode: true }),
    ).toBe("claude_ds");
    expect(
      pickRuntime({ filesTouched: 1, specClear: true, liveCodexSession: true, isCode: true }),
    ).toBe("codex");
    expect(
      pickRuntime({ filesTouched: 0, specClear: true, liveCodexSession: false, isCode: false }),
    ).toBe("omnis");
  });

  it("caps runaway proposals", () => {
    expect(DELEGATION_DAILY_CAP).toBe(5);
    expect(DELEGATION_THREAD_CAP_24H).toBe(2);
  });
});
