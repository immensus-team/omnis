import { describe, expect, it } from "vitest";
import { en, ko, t } from "../src/i18n/index";
import type { DottedKeyPath, Locale } from "../src/i18n/index";

/** 리프(문자열)까지의 점 표기 경로를 모은다 — 사전 두 벌의 키 형태를 깊이 비교하기 위한 것. */
function keyPaths(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keyPaths(v, `${prefix}${k}.`),
  );
}

const KO_KEYS = keyPaths(ko);
const LOCALES: readonly Locale[] = ["ko", "en"];

describe("i18n 사전 (A5 §8 마이크로카피)", () => {
  it("ko와 en의 키 경로가 완전히 일치한다", () => {
    expect(keyPaths(en)).toEqual(KO_KEYS);
  });

  it("빈 문자열로 해석되는 키가 없다", () => {
    for (const locale of LOCALES) {
      for (const key of KO_KEYS) {
        expect(t(locale, key as DottedKeyPath).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("스펙 §8의 한국어 원문을 그대로 돌려준다", () => {
    expect(t("ko", "common.draftCard.editAndSend")).toBe("수정 후 보내기");
    expect(t("ko", "emptyStates.inbox")).toBe("받은 편지함이 비어 있습니다");
    expect(t("en", "common.draftCard.editAndSend")).toBe("Edit & send");
  });

  it("{변수}를 치환한다", () => {
    expect(t("ko", "errors.inbox.channelDisconnected", { channel: "Slack" })).toBe(
      "Slack 연결이 끊겼어요 — 재연결",
    );
    expect(t("en", "digest.briefingPreparing", { n: 5 })).toBe(
      "Preparing your briefing, refreshes in 5m",
    );
  });

  it("변수가 빠지면 플레이스홀더를 원문 그대로 남긴다", () => {
    expect(t("ko", "errors.offline.banner")).toBe("오프라인 — 마지막 동기화 {n}분 전");
  });

  it("복수형 규약: 단수/복수가 다르게 해석된다", () => {
    expect(t("en", "common.itemCount", { count: 1 })).toBe("1 item");
    expect(t("en", "common.itemCount", { count: 5 })).toBe("5 items");
    expect(t("en", "common.itemCount", { count: 0 })).toBe("0 items");
    // 한국어는 복수 범주가 "other" 하나뿐이라 평문 — 같은 메커니즘이 양쪽 다 안전해야 한다.
    expect(t("ko", "common.itemCount", { count: 1 })).toBe("1개 항목");
    expect(t("ko", "common.itemCount", { count: 5 })).toBe("5개 항목");
  });

  it("없는 키는 throw한다(키 문자열 반환이 아님)", () => {
    expect(() => t("ko", "nope.nothing" as DottedKeyPath)).toThrow(/키가 없습니다/);
  });
});
