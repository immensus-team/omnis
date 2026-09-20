// A4 §10.3. Even when one file becomes several memories across chunk boundaries, the
// source_ref is the same, so memories_source_idx (source_kind, source_ref) invalidates them all at once.
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

// A chunk joins its pieces with "\n\n". The real cost is 0.5 tokens (2 ASCII chars), but if we do
// not count it per piece the debt adds up when there are many pieces and blows past the ceiling
// (200 one-line exports → 825 tokens). We round it up to 1 — the conservative side holds the ceiling.
const SEP_TOKENS = 1;

/** Rough inverse of estimateTokens. Only used to cut the overlap tail. */
function tailForTokens(text: string, tokens: number): string {
  let cut = text.length;
  while (cut > 0 && estimateTokens(text.slice(cut - 1)) <= tokens) {
    cut -= 1;
  }
  return text.slice(cut);
}

/** If a paragraph is bigger than the ceiling, go to sentences; if still too big, go to characters. */
function splitOversized(paragraph: string): string[] {
  if (estimateTokens(paragraph) <= CHUNK_MAX_TOKENS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?。？！])\s+/).filter((s) => s !== "");
  const out: string[] = [];
  let buf = "";
  for (const s of sentences.length > 1 ? sentences : [paragraph]) {
    if (estimateTokens(s) > CHUNK_MAX_TOKENS) {
      // If even the sentence is too big (a dump with no line breaks), cut by characters.
      const step = Math.floor(CHUNK_MAX_TOKENS * 1.4); // conservative length assuming wide characters
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

/** delta §3: the only argument is text. source_ref stays an empty string and the caller (runIngest) stamps it. */
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
    // carryTokens is "the cost of prepending carry" = the tail plus one separator (see the SEP_TOKENS comment).
    carryTokens = carry === "" ? 0 : estimateTokens(carry) + SEP_TOKENS;
    buf = [];
    bufTokens = 0;
  };

  for (const p of paragraphs) {
    const t = estimateTokens(p);
    // If bufTokens > 0 then buf is not empty, so one more separator is added.
    if (bufTokens > 0 && carryTokens + bufTokens + SEP_TOKENS + t > CHUNK_MAX_TOKENS) flush();
    // Overlap is "nice to have" — if a single paragraph already nearly fills the ceiling we give up the tail.
    // Otherwise carry pushes the chunk past the ceiling (it really did on a hard-split dump).
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

// ponytail: line-level boundary detection instead of tree-sitter/GitNexus. The limits are clear — a nested
// function gets its own boundary (a python method), while a style that passes closures as values gets no
// boundary. It satisfies A4 §10.3's "do not cut a function in half" (because it only cuts at boundaries).
// If code recall turns out noticeably worse than documents, run the S-A4 tree-sitter spike then.
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

/** A unit with a body (two or more non-empty lines) becomes a chunk on its own. */
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

  // The head before the first boundary (imports etc.) is attached to the first unit.
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
      // If a single unit exceeds the ceiling, split only that unit by the document rules (functions still
      // do not get cut — only a giant function already past the ceiling splits, and that cut is unavoidable).
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
    // Declaration-only lines (imports, one-line exports) are attached to the next unit to avoid one-line chunks.
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

/** A4 §10.3: one event = one chunk. They are already short. */
export function chunkCalendarEvent(e: CalendarChunkInput): Chunk {
  const lines = [
    `Title: ${e.title}`,
    `Start: ${e.start_at}`,
    `End: ${e.end_at}`,
    ...(e.location === null ? [] : [`Location: ${e.location}`]),
    ...(e.attendees.length === 0 ? [] : [`Attendees: ${e.attendees.join(", ")}`]),
    ...(e.description === null ? [] : [`Description: ${e.description}`]),
  ];
  return {
    text: lines.join("\n"),
    ord: 0,
    source_ref: e.external_id,
    meta: { strategy: "calendar" },
  };
}
