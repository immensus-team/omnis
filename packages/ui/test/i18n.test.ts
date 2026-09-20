import { describe, expect, it } from "vitest";
import { en, ko, t, tk } from "../src/i18n/index";
import type { DottedKeyPath, Locale } from "../src/i18n/index";

/** 리프(문자열)까지의 점 표기 경로 → 값. 재귀라 네임스페이스가 늘어도 자동으로 따라간다. */
function leaves(node: object, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "string") out.push([`${prefix}${k}`, v]);
    else out.push(...leaves(v as object, `${prefix}${k}.`));
  }
  return out;
}

/** 사전 두 벌의 키 형태를 깊이 비교하기 위한 것. */
function keyPaths(node: object): string[] {
  return leaves(node).map(([path]) => path);
}

/** 경로로 값 하나를 꺼낸다 — 키 일치를 이미 확인했으므로 실패는 곧 테스트 실패다. */
function valueAt(dict: object, path: string): string {
  let node: unknown = dict;
  for (const part of path.split(".")) node = (node as Record<string, unknown>)[part];
  return node as string;
}

const PLURAL_RE = /\{(\w+)\s*,\s*plural\s*,\s*((?:\s*\w+\s*\{[^{}]*\}\s*)+)\}/g;
const BRANCH_RE = /\s*(\w+)\s*\{([^{}]*)\}/g;

/** 문자열이 실제로 요구하는 치환 변수 이름들(정렬). 복수형 덩어리
 * `{count, plural, one{# item} other{# items}}`는 먼저 분기 몸통으로 펼친 뒤에 세야 한다 —
 * 안 그러면 변수 `count`를 놓쳐서, ko(`{count}개 항목`)와 en을 멀쩡히 다른 것으로 오판한다. */
function placeholders(value: string): string[] {
  const names = new Set<string>();
  const flat = value.replace(PLURAL_RE, (_whole, name: string, branches: string) => {
    names.add(name);
    let body = "";
    branches.replace(BRANCH_RE, (_b, _branch: string, text: string) => {
      body += text;
      return _b;
    });
    return body;
  });
  for (const m of flat.matchAll(/\{(\w+)\}/g)) if (m[1] !== undefined) names.add(m[1]);
  return [...names].sort();
}

/** 의도적 예외 — 이 한 키만 ko/en의 변수 집합이 다르다. §8 표상 한국어 푸시는 요약을 함께
 * 보여주고("… 승인이 필요해요 · {summary}") 영어는 짧은 알림이라 요약을 뺀다(이전 슬라이스에서
 * 확정된 스펙 차이). 예외가 조용히 늘어나지 못하도록 아래 전용 테스트에서 실제 차이를 못박는다. */
const PLACEHOLDER_EXCEPTIONS = new Set(["approvals.pushNotification"]);

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

  it("t()가 서로 다른 네임스페이스의 실제 키를 양 로케일에서 해석한다", () => {
    // 네임스페이스를 가로지르는 스모크 — 사전이 커져도 이 셋은 살아 있어야 한다.
    expect(t("ko", "inbox.title")).toBe("받은 편지함");
    expect(t("en", "inbox.title")).toBe("Inbox");
    expect(t("ko", "settings.modelTiers.limitLabel")).toBe("월 비용 상한");
    expect(t("en", "settings.modelTiers.limitLabel")).toBe("Monthly cost cap");
    expect(t("ko", "notes.routing.confidenceHigh")).toBe("신뢰도 높음");
    expect(t("en", "notes.routing.confidenceHigh")).toBe("High confidence");
  });

  it("{변수}를 치환한다", () => {
    expect(t("ko", "errors.inbox.channelDisconnected", { channel: "Slack" })).toBe(
      "Slack 연결이 끊겼어요 — 재연결",
    );
    expect(t("en", "digest.briefingPreparing", { n: 5 })).toBe(
      "Preparing your briefing, refreshes in 5m",
    );
    // 같은 키에 여러 변수 — 하나만 채우면 나머지는 플레이스홀더로 남아야 한다.
    expect(t("ko", "today.summary", { items: 3, approvals: 2 })).toBe(
      "오늘 처리할 항목 3개, 대기 중 승인 2건.",
    );
    expect(t("en", "today.summary", { items: 3, approvals: 2 })).toBe(
      "3 items to handle today, 2 awaiting approval.",
    );
    expect(t("ko", "relativeTime.minutesAgo", { n: 5 })).toBe("5분 전");
    expect(t("en", "relativeTime.minutesAgo", { n: 5 })).toBe("5m ago");
  });

  it('tk()가 t("ko", …)와 같은 값을 돌려준다 (변수 있는 키/없는 키 양쪽)', () => {
    // 변수 있는 키 — 복수형 덩어리를 타는 common.itemCount로 래퍼가 vars를 그대로 넘기는지 본다.
    expect(tk("common.itemCount", { count: 5 })).toBe(t("ko", "common.itemCount", { count: 5 }));
    expect(tk("common.itemCount", { count: 5 })).toBe("5개 항목");
    expect(tk("relativeTime.minutesAgo", { n: 5 })).toBe(
      t("ko", "relativeTime.minutesAgo", { n: 5 }),
    );
    // 변수 없는 키 — 두 번째 인자를 아예 안 넘긴 호출도 동일해야 한다.
    expect(tk("inbox.title")).toBe(t("ko", "inbox.title"));
    expect(tk("inbox.title")).toBe("받은 편지함");
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

describe("i18n 사전 드리프트 (변수 집합 일치)", () => {
  it("placeholders()가 복수형 덩어리를 변수 하나로 정규화한다", () => {
    // 이 정규화가 없으면 common.itemCount가 매번 가짜 드리프트로 잡힌다.
    expect(placeholders("{count, plural, one{# item} other{# items}}")).toEqual(["count"]);
    expect(placeholders("{count}개 항목")).toEqual(["count"]);
    expect(placeholders("라벨 {n}개 더 보기")).toEqual(["n"]);
    expect(placeholders("저장")).toEqual([]);
    // 변수 이름은 순서가 아니라 집합으로 비교한다 — 번역이 어순을 바꾸는 건 정상이다.
    expect(placeholders("{a} 다음 {b}")).toEqual(placeholders("{b} 먼저, {a} 나중"));
    expect(placeholders("{a} 다음 {b}")).not.toEqual(placeholders("{a} 다음"));
  });

  it("모든 리프에서 ko와 en의 {변수} 집합이 같다", () => {
    const drift: string[] = [];
    for (const [path, koValue] of leaves(ko)) {
      if (PLACEHOLDER_EXCEPTIONS.has(path)) continue;
      const koVars = placeholders(koValue).join(",");
      const enVars = placeholders(valueAt(en, path)).join(",");
      if (koVars !== enVars) drift.push(`${path}: ko{${koVars}} ≠ en{${enVars}}`);
    }
    expect(drift).toEqual([]);
  });

  it("검사가 헛돌지 않는다 — 변수를 쓰는 키가 실제로 여럿이다", () => {
    // 위 검사는 placeholders()가 전부 빈 배열을 내면 조용히 통과한다. 그 구멍을 막는다.
    const withVars = leaves(ko).filter(([, value]) => placeholders(value).length > 0);
    expect(withVars.length).toBeGreaterThan(20);
    expect(leaves(ko).length).toBeGreaterThan(100);
    // 양방향으로 실제로 잡아내는지 — 문구가 달라도 변수가 같으면 통과, 한쪽이 변수를 흘리면 실패.
    const sameVars = (a: string, b: string) => placeholders(a).join() === placeholders(b).join();
    expect(sameVars("{n}개", "{n} items")).toBe(true);
    expect(sameVars("{n}개", "{n}개 · {summary}")).toBe(false); // ko만 변수를 더 씀
    expect(sameVars("{n} items", "n items")).toBe(false); // en이 변수를 지우고 값을 직접 박음
  });

  it("플레이스홀더 예외는 approvals.pushNotification 하나뿐이다", () => {
    expect([...PLACEHOLDER_EXCEPTIONS]).toEqual(["approvals.pushNotification"]);
    // 예외의 실제 모양을 못박는다 — 어느 한쪽이 바뀌면 여기서 먼저 걸린다(예외가 낡는 걸 방지).
    expect(placeholders(ko.approvals.pushNotification)).toEqual(["action", "summary"]);
    expect(placeholders(en.approvals.pushNotification)).toEqual(["action"]);
  });
});
