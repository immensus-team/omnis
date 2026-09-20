// A4 §10.3. 청크 경계를 넘어 같은 파일이 여러 memory가 되어도 source_ref가 같으므로
// memories_source_idx (source_kind, source_ref)로 한 번에 무효화된다.
import { estimateTokens } from "../tokens.js";

export interface Chunk {
  text: string;
  ord: number;
  source_ref: string;
  meta: Record<string, unknown>;
}

export const CHUNK_MIN_TOKENS = 500;
export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_OVERLAP_TOKENS = 100;

// 청크는 조각을 "\n\n"으로 잇는다. 실제 비용은 0.5토큰(ASCII 2자)이지만 조각마다 세지 않으면
// 조각이 많을 때 그 빚이 쌓여 상한을 넘는다(한 줄짜리 export 200개 → 825토큰이었다).
// 1로 올려 잡는다 — 보수적인 쪽이 상한을 지킨다.
const SEP_TOKENS = 1;

/** estimateTokens의 역함수 근사. 오버랩 꼬리를 자를 때만 쓴다. */
function tailForTokens(text: string, tokens: number): string {
  let cut = text.length;
  while (cut > 0 && estimateTokens(text.slice(cut - 1)) <= tokens) {
    cut -= 1;
  }
  return text.slice(cut);
}

/** 한 문단이 상한보다 크면 문장 → 그래도 크면 문자 단위로 쪼갠다. */
function splitOversized(paragraph: string): string[] {
  if (estimateTokens(paragraph) <= CHUNK_MAX_TOKENS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?。？！])\s+/).filter((s) => s !== "");
  const out: string[] = [];
  let buf = "";
  for (const s of sentences.length > 1 ? sentences : [paragraph]) {
    if (estimateTokens(s) > CHUNK_MAX_TOKENS) {
      // 문장조차 크면(줄바꿈 없는 덤프) 문자 단위로 자른다.
      const step = Math.floor(CHUNK_MAX_TOKENS * 1.4); // wide 문자 기준 보수적 길이
      for (let i = 0; i < s.length; i += step) out.push(s.slice(i, i + step));
      continue;
    }
    if (buf !== "" && estimateTokens(`${buf} ${s}`) > CHUNK_MAX_TOKENS) {
      out.push(buf);
      buf = s;
    } else {
      buf = buf === "" ? s : `${buf} ${s}`;
    }
  }
  if (buf !== "") out.push(buf);
  return out;
}

/** 델타 §3: 인자는 text 하나다. source_ref는 빈 문자열로 두고 호출자(runIngest)가 찍는다. */
export function chunkDocument(text: string): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .flatMap(splitOversized);
  if (paragraphs.length === 0) return [];

  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let carry = "";
  let carryTokens = 0;

  const flush = (): void => {
    if (buf.length === 0) return;
    const chunk: Chunk = {
      text: (carry === "" ? buf : [carry, ...buf]).join("\n\n").trim(),
      ord: chunks.length,
      source_ref: "",
      meta: { strategy: "document" },
    };
    chunks.push(chunk);
    carry = tailForTokens(chunk.text, CHUNK_OVERLAP_TOKENS);
    // carryTokens는 "carry를 앞에 붙이는 비용" = 꼬리 + 구분자 하나다(SEP_TOKENS 주석 참고).
    carryTokens = carry === "" ? 0 : estimateTokens(carry) + SEP_TOKENS;
    buf = [];
    bufTokens = 0;
  };

  for (const p of paragraphs) {
    const t = estimateTokens(p);
    // bufTokens > 0이면 buf가 비어 있지 않으므로 구분자 하나가 더 붙는다.
    if (bufTokens > 0 && carryTokens + bufTokens + SEP_TOKENS + t > CHUNK_MAX_TOKENS) flush();
    // 오버랩은 "있으면 좋은 것"이다 — 문단 하나가 이미 상한을 거의 채우면 꼬리를 포기한다.
    // 그러지 않으면 carry 때문에 청크가 상한을 넘는다(하드 스플릿된 덤프에서 실제로 넘었다).
    if (bufTokens === 0 && carryTokens + t > CHUNK_MAX_TOKENS) {
      carry = "";
      carryTokens = 0;
    }
    bufTokens += (buf.length === 0 ? 0 : SEP_TOKENS) + t;
    buf.push(p);
    if (bufTokens >= CHUNK_MIN_TOKENS) flush();
  }
  flush();
  return chunks;
}

// ponytail: tree-sitter/GitNexus 대신 줄 단위 경계 탐지. 한계는 명확하다 — 중첩 함수는 자체
// 경계로 잡히고(python의 메서드), 클로저를 값으로 넘기는 스타일은 경계가 안 잡힌다. A4 §10.3이
// 요구하는 "함수를 반토막내지 않는다"는 만족한다(경계에서만 자르므로). 코드 recall이 문서보다
// 눈에 띄게 나쁘면 그때 S-A4의 tree-sitter 스파이크를 돈다.
const BOUNDARY =
  /^(?:\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+\w|class\s+\w|def\s+\w|type\s+\w+\s*=|interface\s+\w|const\s+\w+\s*=\s*(?:async\s*)?\(|func\s+\w|impl\s+\w|public\s+|private\s+)/;

const LANG_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  py: "py",
  go: "go",
  rs: "rs",
  java: "java",
  rb: "rb",
  swift: "swift",
  kt: "kt",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  sql: "sql",
  sh: "sh",
};

/** 본문이 있는 단위(비어 있지 않은 줄이 2줄 이상)는 그 자체로 청크가 된다. */
function hasBody(unit: string): boolean {
  let seen = 0;
  for (const line of unit.split("\n")) {
    if (line.trim() !== "") seen += 1;
    if (seen > 1) return true;
  }
  return false;
}

export function chunkCode(path: string, text: string): Chunk[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const language = LANG_BY_EXT[ext];
  const lines = text.split("\n");
  const starts: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (BOUNDARY.test(line)) starts.push(i);
  }
  if (language === undefined || starts.length === 0) {
    return chunkDocument(text).map((c) => ({ ...c, source_ref: path }));
  }

  // 첫 경계 앞의 머리(import 등)는 첫 단위에 붙인다.
  const bounds = starts[0] === 0 ? starts : [0, ...starts];
  const units: string[] = [];
  for (const [i, start] of bounds.entries()) {
    const end = bounds[i + 1] ?? lines.length;
    units.push(lines.slice(start, end).join("\n").trimEnd());
  }

  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  const flush = (): void => {
    if (buf.length === 0) return;
    chunks.push({
      text: buf.join("\n\n"),
      ord: chunks.length,
      source_ref: path,
      meta: { strategy: "code", language },
    });
    buf = [];
    bufTokens = 0;
  };
  for (const u of units) {
    if (u.trim() === "") continue;
    const t = estimateTokens(u);
    if (bufTokens > 0 && bufTokens + SEP_TOKENS + t > CHUNK_MAX_TOKENS) flush();
    if (t > CHUNK_MAX_TOKENS) {
      // 단위 하나가 상한을 넘으면 그 단위만 문서 규칙으로 쪼갠다(함수는 여전히 안 쪼개진다 —
      // 쪼개지는 것은 이미 상한을 넘은 거대 함수뿐이고, 그건 반토막이 불가피하다).
      flush();
      for (const piece of splitOversized(u)) {
        chunks.push({
          text: piece,
          ord: chunks.length,
          source_ref: path,
          meta: { strategy: "code", language, oversized: true },
        });
      }
      continue;
    }
    bufTokens += (buf.length === 0 ? 0 : SEP_TOKENS) + t;
    buf.push(u);
    // 선언만 있는 줄(import, 한 줄짜리 export)은 다음 단위에 붙여 한 줄 청크를 막는다.
    if (hasBody(u)) flush();
  }
  flush();
  return chunks;
}

export interface CalendarChunkInput {
  external_id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  attendees: string[];
  description: string | null;
}

/** A4 §10.3: 이벤트 1건 = 청크 1개. 이미 짧다. */
export function chunkCalendarEvent(e: CalendarChunkInput): Chunk {
  const lines = [
    `제목: ${e.title}`,
    `시작: ${e.start_at}`,
    `종료: ${e.end_at}`,
    ...(e.location === null ? [] : [`장소: ${e.location}`]),
    ...(e.attendees.length === 0 ? [] : [`참석자: ${e.attendees.join(", ")}`]),
    ...(e.description === null ? [] : [`설명: ${e.description}`]),
  ];
  return {
    text: lines.join("\n"),
    ord: 0,
    source_ref: e.external_id,
    meta: { strategy: "calendar" },
  };
}
