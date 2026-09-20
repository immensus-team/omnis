// A4 §1.4 정규화 파이프라인 + §11.1 태그 탈출 차단 + §11.2-A 룰 스캐너.
// 순서가 방어다: 숨김 노드를 먼저 지우지 않으면 태그를 걷어낸 뒤 숨은 지시문이 본문이 된다.
import { randomBytes } from "node:crypto";

export const NORMALIZE_MAX_CHARS = 8000;
const HEAD_CHARS = 4000;
const TAIL_CHARS = 2000;
const REDACTED = "⟦redacted-tag⟧";

/** 델타 §4가 고정한 5개. A4 §11.2-A의 9개 정규식은 이 5개로 접힌다. */
export const INJECTION_FLAGS: readonly string[] = [
  "instruction_override",
  "credential_request",
  "exfil_link",
  "phantom_tool",
  "tag_escape",
] as const;

/** A4 §1.4: 실행마다 새로 뽑는 16 hex. nonce를 모르면 블록을 닫을 수 없다. */
export function newNonce(): string {
  return randomBytes(8).toString("hex");
}

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;/g, "'"],
];

// 숨김 노드: 여는 태그의 style 속성에 display:none / font-size:0 / 흰 글씨가 걸린 것.
// ponytail: 정규식은 같은 태그의 중첩을 못 본다. 메일 본문에서 숨김 div 안에 같은 div가
// 중첩되는 경우는 관측된 적이 없고, 겉 태그가 지워지면 안쪽 텍스트도 같이 지워진다.
// 파서가 필요해지면 그때 parse5를 넣는다.
const HIDDEN_NODE =
  /<([a-z][a-z0-9]*)\b[^>]*style\s*=\s*(["'])(?:(?!\2).)*?(?:display\s*:\s*none|font-size\s*:\s*0|color\s*:\s*#f{3}(?:f{3})?\b)(?:(?!\2).)*?\2[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** 경계 태그(`data`/`system`/`instructions`/`tool`)는 일반 태그 제거에서 **빼 둔다** —
 *  여기서 공백으로 지워 버리면 5단계 탈출 차단이 증거를 잃고 플래그도 못 단다. */
const BOUNDARY_TAG_NAMES = "data|system|instructions?|tool";
const HTML_TAG = new RegExp(`<(?!/?\\s*(?:${BOUNDARY_TAG_NAMES})\\b)[^>]+>`, "g");
const BOUNDARY_TAG = new RegExp(`</?\\s*(?:${BOUNDARY_TAG_NAMES})\\b[^>]*>?`, "gi");

const BLOB = /[A-Za-z0-9+/]{200,}={0,2}/g;
const URL_WITH_QUERY = /(https?:\/\/[^\s"'<>]+?)\?[^\s"'<>]*/g;

export function normalizeExternal(text: string, nonce: string): string {
  // 1. NFKC + zero-width 제거
  let out = text.normalize("NFKC").replace(/[​-‏﻿]/g, "");

  // 2. HTML: 숨김 노드 → script/style → 주석 → 남은 태그 → 엔티티
  out = out
    .replace(HIDDEN_NODE, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const stripped = out.replace(HTML_TAG, " ");
  const hadTags = stripped !== out;
  out = stripped;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  if (hadTags) out = out.replace(/[ \t]{2,}/g, " ").trim();

  // 3. base64/hex 블록은 디코드하지 않는다. 길이만 말한다.
  out = out.replace(BLOB, (m) => `[base64 blob, ${m.length} bytes]`);

  // 4. URL은 스킴+호스트+경로만. 쿼리스트링은 provenance에만 남는다.
  out = out.replace(URL_WITH_QUERY, (_m, head: string) => `${head}?…`);

  // 5. 태그 탈출 차단 — nonce를 모르면 블록을 닫을 수 없게 만드는 마지막 문.
  out = out
    .replaceAll(`d_${nonce}`, REDACTED)
    .replace(BOUNDARY_TAG, REDACTED)
    .replaceAll("</data", REDACTED)
    .replaceAll("[system]", REDACTED);

  if (out.length > NORMALIZE_MAX_CHARS) {
    const omitted = out.length - HEAD_CHARS - TAIL_CHARS;
    out = `${out.slice(0, HEAD_CHARS)}[…${omitted}자 생략…]${out.slice(out.length - TAIL_CHARS)}`;
  }
  return out;
}

export function wrapData(
  text: string,
  attrs: { nonce: string; source: string; thread?: string; asOf: string },
): string {
  const thread = attrs.thread === undefined ? "" : ` thread="${attrs.thread}"`;
  return `<data id="d_${attrs.nonce}" source="${attrs.source}"${thread} as_of="${attrs.asOf}">\n${text}\n</data>`;
}

/** A4 §1.5의 팬텀 tool 12종. `@omnis/agents/src/tools`의 PHANTOM_TOOLS(US-B06)는 레지스트리
 *  쪽 목록이고, 이쪽은 "텍스트에 이 이름이 보이면 스캔한다"는 탐지 쪽이다. 둘이 갈리면
 *  US-B06의 테스트가 두 목록을 대조해 깨뜨린다. */
const EGRESS_WORDS =
  /\b(send_message|send_email|reply|delete_item|archive|calendar_create|calendar_update|run_agent|exec|read_file|http_fetch|read_secret)\b/i;

const SCANNERS: Array<{ flag: string; re: RegExp }> = [
  {
    flag: "instruction_override",
    re: /(이전|위의|앞의|previous|above|prior)\s*(지시|명령|instruction|prompt)[^.]{0,20}(무시|잊|ignore|disregard|forget)/i,
  },
  // 영어는 동사가 앞에 온다("Ignore all previous instructions") — 위 정규식은 명사→동사 순서만 본다.
  {
    flag: "instruction_override",
    re: /\b(ignore|disregard|forget)\b[^.]{0,30}\b(instructions?|prompts?|rules?)\b/i,
  },
  {
    flag: "instruction_override",
    re: /(나는|I am|this is)\s*(시스템|관리자|admin|system|anthropic|openai|developer)/i,
  },
  {
    flag: "instruction_override",
    re: /(즉시|지금\s*당장|urgent(ly)?|immediately)[^.]{0,30}(승인|approve|실행|execute|보내)/i,
  },
  {
    flag: "credential_request",
    re: /(비밀번호|패스워드|토큰|api\s*key|secret|credential|키체인|keychain)/i,
  },
  { flag: "exfil_link", re: /(보내|전달|forward|send)\s*(주세요|해줘|to)?\s*[\w.+-]+@[\w.-]+/i },
  // 한국어는 조사가 붙어 주소가 먼저 온다("attacker@evil.com 으로 전달해줘").
  { flag: "exfil_link", re: /[\w.+-]+@[\w.-]+[^.]{0,20}(보내|전달|forward|send)/i },
  { flag: "phantom_tool", re: EGRESS_WORDS },
  { flag: "tag_escape", re: /<\/?\s*(system|data|instructions?|tool)\b/i },
];

/** 조립기가 **정규화 전 원문**에 돌린다(~2ms). 정규화가 태그와 숨김 텍스트를 지워버리면
 *  탐지할 것이 사라지기 때문이다. 이 함수는 차단하지 않는다 — 플래그만 단다(A4 §11.2). */
export function scanInjection(text: string): string[] {
  const found = new Set<string>();
  for (const s of SCANNERS) {
    if (s.re.test(text)) found.add(s.flag);
  }
  return INJECTION_FLAGS.filter((f) => found.has(f));
}
