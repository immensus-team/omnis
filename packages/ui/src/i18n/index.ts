import { en } from "./en.js";
import { ko } from "./ko.js";
import type { Dictionary, DottedKeyPath, Locale, Vars } from "./types.js";

export { en, ko };
export type { Dictionary, DottedKeyPath, Locale, Vars };

const DICTIONARIES: Record<Locale, Dictionary> = { ko, en };

/** 복수형 규약: 사전 문자열 안에 ICU의 최소 부분집합 `{변수, plural, one{…} other{…}}` 를 쓴다.
 * 분기 안의 `#` 는 변수 값으로 치환된다. 완전한 ICU가 아니라 UI 마이크로카피용 축약이다 —
 * `=0`/`few`/`many`/`offset:` 등은 지원하지 않는다(필요해지면 여기만 늘린다).
 * 한국어는 CLDR상 복수 범주가 "other" 하나뿐이라 ko 문자열은 평문으로 둔다 — 즉 이 규약은
 * 지금 en의 `common.itemCount` 하나만 실제로 탄다. */
const PLURAL_RE = /\{(\w+)\s*,\s*plural\s*,\s*((?:\s*\w+\s*\{[^{}]*\}\s*)+)\}/g;
const BRANCH_RE = /\s*(\w+)\s*\{([^{}]*)\}/g;

/** 변수 누락은 조용히 지우지 않고 플레이스홀더를 원문 그대로 남긴다 — 화면에 `{channel}`이
 * 보이면 호출부 버그를 바로 알 수 있다(빈 문자열로 뭉개면 아무도 모른다). */
function resolvePlurals(text: string, vars: Vars): string {
  return text.replace(PLURAL_RE, (whole, name: string, branches: string) => {
    const count = Number(vars[name]);
    if (!Number.isFinite(count)) return whole;
    let one: string | undefined;
    let other: string | undefined;
    branches.replace(BRANCH_RE, (branchWhole, branch: string, body: string) => {
      if (branch === "one") one = body;
      else if (branch === "other") other = body;
      return branchWhole;
    });
    // CLDR 축약: 정확히 1만 one, 나머지는 other(0 포함 — 영어 "0 items").
    const picked = count === 1 ? (one ?? other) : other;
    return picked === undefined ? whole : picked.replace(/#/g, String(count));
  });
}

/** 복수형을 먼저 확정한 뒤 단순 `{변수}`를 채운다 — 순서가 뒤집히면 분기 안의 변수가 안 채워진다. */
function interpolate(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

/** 없는 키는 **throw**한다(키 문자열을 그대로 돌려주지 않는다) — 컴파일 타임에 DottedKeyPath가
 * 막아주지만, 사전을 JS에서 동적으로 읽는 호출부는 여기서 즉시 실패한다. */
function lookup(locale: Locale, key: string): string {
  let node: unknown = DICTIONARIES[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) {
      throw new Error(`i18n: ${locale} 사전에 "${key}" 키가 없습니다 (없는 조각: "${part}")`);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") {
    throw new Error(`i18n: "${key}"는 문자열 리프가 아닙니다 (${locale})`);
  }
  return node;
}

export function t(locale: Locale, key: DottedKeyPath, vars?: Vars): string {
  const text = lookup(locale, key);
  return vars === undefined ? text : interpolate(resolvePlurals(text, vars), vars);
}
