/** 아직 사전으로 빠지지 않은 하드코딩 문구를 훑어 tools/i18n/report.md를 낳는다 — 마이그레이션
 * 대상 목록을 손으로 뒤지는 대신 뽑아 보려는 도구다. 읽기 전용: 소스는 절대 고치지 않는다.
 *
 * 완전한 파서가 아니라 휴리스틱이라 오탐·누락이 둘 다 있다(한계는 리포트 꼬리에 적어 둔다).
 * 그래서 "이 줄을 지워라"가 아니라 "여기 후보가 있다"는 출발점으로만 쓴다.
 *
 * 실행: 리포 루트에서 `npx tsx tools/i18n/scan.ts` (인자 없음). */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SOURCE_DIRS = ["apps/desktop/src", "packages/ui/src"];
/** 사전 자체는 스캔 대상이 아니다 — 여기 있는 건 전부 "이미 i18n된" 문구다. */
const DICTIONARY_DIR = join("packages/ui", "src", "i18n");
const REPORT_PATH = join(REPO_ROOT, "tools", "i18n", "report.md");
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "coverage", "build", ".git"]);
const SKIP_FILE_RE = /\.(test|spec)\.[cm]?tsx?$/;
const MAX_TEXT = 80;

const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const FILE_RE = /^\S+\.(tsx?|jsx?|css|json|md|png|svg|html|ya?ml|sql|sh|toml|woff2?)$/i;

interface Hit {
  text: string;
  offset: number;
  /** JSX 텍스트 노드(`<h1>받은 편지함</h1>`)면 true — 위치 판정과 영어 휴리스틱이 달라진다. */
  jsx: boolean;
}

interface Candidate {
  file: string;
  line: number;
  text: string;
  key: string;
}

/** 주석을 같은 길이의 공백으로 덮는다 — 오프셋(=줄 번호)이 그대로 남아서 이후 두 패스가 같은
 * 좌표계를 쓴다. 이 리포지토리는 주석에 한국어가 흔해서, 안 걷어내면 리포트가 설명문으로 뒤덮인다.
 * 문자열 안의 `//`(URL 등)를 주석으로 오인하지 않으려고 문자열 상태를 함께 추적한다. */
function maskComments(src: string): string {
  const out = src.split("");
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl < 0 ? src.length : nl;
      for (let k = i; k < end; k++) out[k] = " ";
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const found = src.indexOf("*/", i + 2);
      const end = found < 0 ? src.length : found + 2;
      for (let k = i; k < end; k++) if (out[k] !== "\n") out[k] = " ";
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        const ch = src[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === c) break;
        // 작은/큰따옴표는 줄을 넘지 못한다(넘으면 그건 문자열이 아니라 어퍼스트로피 오타다).
        if (c !== "`" && ch === "\n") break;
        j++;
      }
      i = src[j] === c ? j + 1 : i + 1;
      continue;
    }

    i++;
  }

  return out.join("");
}

/** 마스킹된 소스에서 문자열/템플릿 리터럴만 줍는다(주석은 이미 공백이라 자연히 빠진다). */
function scanLiterals(src: string): Hit[] {
  const hits: Hit[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === '"' || c === "'" || c === "`") {
      const start = i + 1;
      let j = start;
      while (j < src.length) {
        const ch = src[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === c) break;
        // 작은/큰따옴표는 줄을 넘지 못한다(넘으면 그건 문자열이 아니라 어퍼스트로피 오타다).
        if (c !== "`" && ch === "\n") break;
        j++;
      }
      // 닫는 따옴표를 못 찾았으면 한 글자만 진행한다 — 정규식 리터럴이나 JSX 텍스트의
      // 어퍼스트로피(don't)에 스캐너가 통째로 삼켜지지 않게.
      if (src[j] !== c) {
        i++;
        continue;
      }
      hits.push({ text: src.slice(start, j), offset: start, jsx: false });
      i = j + 1;
      continue;
    }

    i++;
  }

  return hits;
}

/** JSX 텍스트 노드. 중괄호·부등호가 없는 구간만 주워서 표현식 보간(`{count}개`)은 리터럴 쪽이
 * 잡게 둔다. `a > b < c` 같은 비교식도 걸리지만, 공백 없는 한 토막이라 아래 휴리스틱이 걷어낸다. */
function scanJsxText(masked: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of masked.matchAll(/>([^<>{}]+)</g)) {
    const offset = m.index;
    const text = m[1];
    if (offset !== undefined && text !== undefined) hits.push({ text, offset: offset + 1, jsx: true });
  }
  return hits;
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** 문구인가, 코드 조각인가. 한국어는 거의 확실히 문구라 먼저 통과시키고, 영어는 "문장처럼
 * 보이는 것"만 남긴다 — 그래서 컴포넌트 안의 단어 하나짜리 영어 라벨(Save/Retry)은 놓친다.
 * 기본 로케일이 ko라 그 라벨들도 한국어 쪽에서 잡히므로 의도된 트레이드오프다. */
function classify(text: string, jsx: boolean): boolean {
  const s = text.trim();
  if (s.length === 0) return false;
  if (HEX_RE.test(s) || FILE_RE.test(s)) return false; // 색상값 / 파일명
  if (s.includes("://") || s.startsWith("/") || s.startsWith("./") || s.startsWith("../")) return false; // URL·경로
  if (HANGUL_RE.test(s)) return true;
  if (!/[A-Za-z]{2}/.test(s)) return false;

  // className/식별자: 공백 없이 전부 소문자이면서 구분자(-, :, /)를 포함 — tailwind가 대표적.
  // 대문자로 시작하는 하이픈 단어("Read-only")는 살아남도록 소문자 조건을 둔다.
  if (!/\s/.test(s) && s === s.toLowerCase() && /[-:/]/.test(s)) return false;

  // 단어 하나짜리 영어는 기술 토큰으로 본다(키 이름·enum 값 등).
  if (jsx) return s.length > 1 && /^[A-Z]/.test(s);
  return s.length > 3 && /\s/.test(s) && /^[A-Z]/.test(s);
}

/** 가장 가까운 앞쪽 컴포넌트 선언 이름. 못 찾으면 파일명으로 떨어진다. */
function enclosingName(src: string, offset: number, file: string): string {
  const head = src.slice(0, offset);
  const patterns = [
    /(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)/g,
    /(?:const|let)\s+([A-Z]\w*)\s*[:=]/g,
    /(?:export\s+)?class\s+([A-Z]\w*)/g,
  ];
  let name = "";
  let best = -1;
  for (const re of patterns) {
    for (const m of head.matchAll(re)) {
      if (m.index !== undefined && m.index > best) {
        best = m.index;
        name = m[1] ?? name;
      }
    }
  }
  return name || basename(file).replace(/\.tsx?$/, "");
}

/** 리터럴 바로 앞/뒤를 보고 화면에서의 역할을 짐작한다 — 키 이름의 가운데 토막이 된다. */
function roleOf(src: string, hit: Hit): string {
  const before = src.slice(Math.max(0, hit.offset - 40), hit.offset);
  if (/placeholder\s*=\s*["']?$/.test(before)) return "placeholder";
  if (/aria-label\s*=\s*["']?$/.test(before)) return "ariaLabel";
  if (/(?:title|alt|label)\s*=\s*["']?$/.test(before)) return "title";
  const after = src.slice(hit.offset, hit.offset + 160);
  if (/^\s*["'`]?\s*\}?\s*,?\s*[\s\S]{0,60}?on(?:Click|Press|Submit|Change)\b/.test(after)) return "button";
  return hit.jsx ? "label" : "text";
}

function camel(words: readonly string[]): string {
  return words
    .map((w, i) => (i === 0 ? (w[0] ?? "").toLowerCase() + w.slice(1) : (w[0] ?? "").toUpperCase() + w.slice(1)))
    .join("");
}

/** 키 토막으로 쓸 수 있게 이름을 눕힌다: `Inbox` → `inbox`, `FILTERS` → `filters`,
 * `TOOL_LABELS` → `toolLabels`. 상수 이름을 그냥 소문자화하면 `fILTERS`가 나온다. */
function decap(name: string): string {
  if (name === name.toUpperCase()) return camel(name.toLowerCase().split("_").filter((w) => w.length > 0));
  return (name[0] ?? "").toLowerCase() + name.slice(1);
}

/** 문자열 안의 ASCII 단어에서 리프 이름을 짐작한다. 한국어 문구는 ASCII가 없어 줄 번호로
 * 떨어지는데, 그건 의도다 — 한글을 억지로 로마자화한 키보다 `l140`이 정직하고, 사람이
 * 옮기면서 어차피 이름을 다시 짓는다. */
function leafSlug(text: string, line: number): string {
  const words = (text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [])
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .map((w) => w.toLowerCase());
  return words.length > 0 ? camel(words) : `l${line}`;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !SKIP_FILE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

function scanFile(file: string): Candidate[] {
  const rel = relative(REPO_ROOT, file);
  // 사전 자체는 대상이 아니다 — 여기 있는 문구는 전부 "이미 i18n된" 것이다.
  if (rel.startsWith(`${DICTIONARY_DIR}/`)) return [];

  const src = readFileSync(file, "utf8");
  // 주석을 먼저 지운 뒤에 두 패스를 돌린다 — JSX 텍스트 정규식은 주석을 구분하지 못해서,
  // 안 지우면 `// 설명 … const [` 같은 코드가 문구로 둔갑한다.
  const masked = maskComments(src);
  const hits = [...scanLiterals(masked), ...scanJsxText(masked)].sort((a, b) => a.offset - b.offset);

  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!classify(hit.text, hit.jsx)) continue;
    const line = lineAt(src, hit.offset);
    const text = hit.text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
    // 같은 줄에 같은 문구가 두 번 나오면(예: 조건부 렌더) 표에 두 번 넣을 이유가 없다.
    const dedupe = `${line}:${text}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const screen = enclosingName(masked, hit.offset, file);
    const screenKey = decap(screen);
    found.push({
      file: rel,
      line,
      text,
      key: `${screenKey}.${roleOf(src, hit)}.${leafSlug(hit.text, line)}`,
    });
  }
  return found;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function report(all: Candidate[], filesScanned: number, byDir: Map<string, number>): string {
  const lines: string[] = [
    "# i18n 하드코딩 문구 스캔 리포트",
    "",
    "`tsx tools/i18n/scan.ts`가 생성한다 — 손으로 고치지 말 것(다음 실행에 덮인다).",
    "이 리포트는 **읽기 전용 스캔** 결과다: 스크립트는 소스를 고치지 않는다.",
    "",
    "## 요약",
    "",
    `- 스캔한 파일: ${filesScanned}`,
    `- 후보 문자열: ${all.length}`,
    ...SOURCE_DIRS.map((d) => `  - ${d}: ${byDir.get(d) ?? 0}건`),
    "",
    "`Suggested key`는 컴포넌트 이름 + 위치(placeholder/ariaLabel/button/text) + 문자열 속 영단어로",
    "만든 **출발점**이다. 한국어 문구는 영단어가 없어 `l{줄번호}`로 떨어진다 — 옮기면서 이름을",
    "다시 짓는 게 전제다.",
    "",
  ];

  const byFile = new Map<string, Candidate[]>();
  for (const c of all) {
    const bucket = byFile.get(c.file);
    if (bucket === undefined) byFile.set(c.file, [c]);
    else bucket.push(c);
  }

  for (const file of [...byFile.keys()].sort()) {
    const rows = byFile.get(file) ?? [];
    lines.push(`## ${file}`, "", "| Line | Text | Suggested key |", "| --- | --- | --- |");
    for (const r of rows.sort((a, b) => a.line - b.line)) {
      lines.push(`| ${r.line} | ${cell(r.text)} | \`${cell(r.key)}\` |`);
    }
    lines.push("");
  }

  lines.push(
    "## 이 도구의 한계 (오탐·누락은 정상)",
    "",
    "- 완전한 파서가 아니다. TS 파서를 붙이지 않으려고 주석·문자열·템플릿만 걷는 상태 기계를 쓴다.",
    "- 오탐: JSX처럼 보이는 비교식(`a > b < c`), 정규식 리터럴 안의 따옴표, 어퍼스트로피가 만드는",
    "  가짜 문자열. 공백/대문자 휴리스틱이 대부분 걸러내지만 0은 아니다.",
    "- 누락: 단어 하나짜리 영어 라벨(Save, Retry)은 기술 토큰으로 보고 버린다. 기본 로케일이 ko라",
    "  같은 버튼이 한국어 쪽에서 잡히므로 의도적으로 감수한 트레이드오프다.",
    "- 누락: `packages/ui/src/i18n/**`(사전), `*.test.ts(x)`, `node_modules`·`dist`는 대상이 아니다.",
    "",
  );

  return `${lines.join("\n")}`;
}

function main(): void {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) files.push(...walk(join(REPO_ROOT, dir)));

  const all: Candidate[] = [];
  const byDir = new Map<string, number>();
  for (const file of files.sort()) {
    const found = scanFile(file);
    all.push(...found);
    const rel = relative(REPO_ROOT, file);
    const dir = SOURCE_DIRS.find((d) => rel.startsWith(d));
    if (dir !== undefined) byDir.set(dir, (byDir.get(dir) ?? 0) + found.length);
  }

  writeFileSync(REPORT_PATH, report(all, files.length, byDir), "utf8");
  console.log(
    `Scanned ${files.length} files, found ${all.length} candidate strings → ${relative(REPO_ROOT, REPORT_PATH)}`,
  );
}

main();
