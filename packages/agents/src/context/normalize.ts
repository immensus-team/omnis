// A4 §1.4 normalization pipeline + §11.1 tag-escape blocking + §11.2-A rule scanner.
// Order is the defense: hidden nodes must go first, or the hidden instructions become the body once
// tags are stripped.
import { randomBytes } from "node:crypto";

export const NORMALIZE_MAX_CHARS = 8000;
const HEAD_CHARS = 4000;
const TAIL_CHARS = 2000;
const REDACTED = "⟦redacted-tag⟧";

/** The five fixed by delta §4. The 9 regexes of A4 §11.2-A collapse into these 5. */
export const INJECTION_FLAGS: readonly string[] = [
  "instruction_override",
  "credential_request",
  "exfil_link",
  "phantom_tool",
  "tag_escape",
] as const;

/** A4 §1.4: 16 hex drawn fresh per run. Without the nonce you cannot close the block. */
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

// Hidden node: an opening tag whose style attribute carries display:none / font-size:0 / white text.
// ponytail: the regex cannot see nesting of the same tag. In email bodies, a hidden div nesting the
// same div has never been observed, and when the outer tag is removed the inner text goes with it.
// If a parser becomes necessary, add parse5 then.
const HIDDEN_NODE =
  /<([a-z][a-z0-9]*)\b[^>]*style\s*=\s*(["'])(?:(?!\2).)*?(?:display\s*:\s*none|font-size\s*:\s*0|color\s*:\s*#f{3}(?:f{3})?\b)(?:(?!\2).)*?\2[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Boundary tags (`data`/`system`/`instructions`/`tool`) are **excluded** from generic tag
 *  stripping — blanking them here would rob step 5's escape blocking of its evidence, so no flag
 *  could ever be raised. */
const BOUNDARY_TAG_NAMES = "data|system|instructions?|tool";
const HTML_TAG = new RegExp(`<(?!/?\\s*(?:${BOUNDARY_TAG_NAMES})\\b)[^>]+>`, "g");
const BOUNDARY_TAG = new RegExp(`</?\\s*(?:${BOUNDARY_TAG_NAMES})\\b[^>]*>?`, "gi");

const BLOB = /[A-Za-z0-9+/]{200,}={0,2}/g;
const URL_WITH_QUERY = /(https?:\/\/[^\s"'<>]+?)\?[^\s"'<>]*/g;

export function normalizeExternal(text: string, nonce: string): string {
  // 1. NFKC + zero-width removal
  let out = text.normalize("NFKC").replace(/[​-‏﻿]/g, "");

  // 2. HTML: hidden nodes → script/style → comments → remaining tags → entities
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

  // 3. base64/hex blobs are not decoded. Only the length is reported.
  out = out.replace(BLOB, (m) => `[base64 blob, ${m.length} bytes]`);

  // 4. URLs keep scheme+host+path only. The query string survives in provenance alone.
  out = out.replace(URL_WITH_QUERY, (_m, head: string) => `${head}?…`);

  // 5. Tag-escape blocking — the last gate that makes the block unclosable without the nonce.
  out = out
    .replaceAll(`d_${nonce}`, REDACTED)
    .replace(BOUNDARY_TAG, REDACTED)
    .replaceAll("</data", REDACTED)
    .replaceAll("[system]", REDACTED);

  if (out.length > NORMALIZE_MAX_CHARS) {
    const omitted = out.length - HEAD_CHARS - TAIL_CHARS;
    out = `${out.slice(0, HEAD_CHARS)}[…${omitted} chars omitted…]${out.slice(out.length - TAIL_CHARS)}`;
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

/** The 12 phantom tools of A4 §1.5. PHANTOM_TOOLS in `@omnis/agents/src/tools` (US-B06) is the
 *  registry-side list; this one is the detection side — "if this name shows up in the text, scan
 *  for it". If the two diverge, the US-B06 test breaks by comparing the two lists. */
const EGRESS_WORDS =
  /\b(send_message|send_email|reply|delete_item|archive|calendar_create|calendar_update|run_agent|exec|read_file|http_fetch|read_secret)\b/i;

const SCANNERS: Array<{ flag: string; re: RegExp }> = [
  // FROZEN matcher: the Korean alternatives match Korean-language input, which puts the noun
  // before the verb. Every `re:` below that contains Korean is frozen the same way — keep the
  // Korean alternatives verbatim.
  {
    flag: "instruction_override",
    re: /(이전|위의|앞의|previous|above|prior)\s*(지시|명령|instruction|prompt)[^.]{0,20}(무시|잊|ignore|disregard|forget)/i,
  },
  // English puts the verb first ("Ignore all previous instructions") — the regex above only looks
  // at noun→verb order.
  {
    flag: "instruction_override",
    re: /\b(ignore|disregard|forget)\b[^.]{0,30}\b(instructions?|prompts?|rules?)\b/i,
  },
  // FROZEN matcher: the Korean alternatives match Korean-language input.
  {
    flag: "instruction_override",
    re: /(나는|I am|this is)\s*(시스템|관리자|admin|system|anthropic|openai|developer)/i,
  },
  // FROZEN matcher: the Korean alternatives match Korean-language input.
  {
    flag: "instruction_override",
    re: /(즉시|지금\s*당장|urgent(ly)?|immediately)[^.]{0,30}(승인|approve|실행|execute|보내)/i,
  },
  // FROZEN matcher: the Korean alternatives match Korean-language input.
  {
    flag: "credential_request",
    re: /(비밀번호|패스워드|토큰|api\s*key|secret|credential|키체인|keychain)/i,
  },
  // FROZEN matcher: the Korean alternatives match Korean-language input.
  { flag: "exfil_link", re: /(보내|전달|forward|send)\s*(주세요|해줘|to)?\s*[\w.+-]+@[\w.-]+/i },
  // FROZEN matcher: in Korean the particle attaches to the address, so the address comes first and
  // the verb trails it — hence this second, verb-trailing pattern.
  { flag: "exfil_link", re: /[\w.+-]+@[\w.-]+[^.]{0,20}(보내|전달|forward|send)/i },
  { flag: "phantom_tool", re: EGRESS_WORDS },
  { flag: "tag_escape", re: /<\/?\s*(system|data|instructions?|tool)\b/i },
];

/** The assembler runs this on the **raw text before normalization** (~2ms), because normalization
 *  erases tags and hidden text and there would be nothing left to detect. This function does not
 *  block — it only attaches flags (A4 §11.2). */
export function scanInjection(text: string): string[] {
  const found = new Set<string>();
  for (const s of SCANNERS) {
    if (s.re.test(text)) found.add(s.flag);
  }
  return INJECTION_FLAGS.filter((f) => found.has(f));
}
