/** Sweeps hardcoded copy that has not made it into the dictionary yet and produces
 * tools/i18n/report.md — a tool for extracting the migration target list instead of hunting for
 * it by hand. Read-only: it never modifies the sources.
 *
 * It is a heuristic rather than a real parser, so it both over- and under-reports (the limits are
 * written at the tail of the report). Use it as a starting point — "there are candidates here" —
 * not as "delete this line".
 *
 * Run: `npx tsx tools/i18n/scan.ts` from the repo root (no arguments). */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SOURCE_DIRS = ["apps/desktop/src", "packages/ui/src"];
/** The dictionary itself is not a scan target — everything in it is already i18n'd copy. */
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
  /** True for a JSX text node (e.g. `<h1>Inbox</h1>`) — position detection and the English heuristic differ. */
  jsx: boolean;
}

interface Candidate {
  file: string;
  line: number;
  text: string;
  key: string;
}

/** Blank out comments with equal-length whitespace — the offsets (and therefore line numbers)
 * survive, so the two later passes share one coordinate system. Korean comments are common in this
 * repository, and leaving them in would bury the report in prose. String state is tracked alongside
 * so a `//` inside a string (a URL, say) is not mistaken for a comment. */
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
        // Single and double quotes cannot span lines (if one appears to, it is a stray apostrophe, not a string).
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

/** Collect only string/template literals from the masked source (comments are already whitespace, so they drop out). */
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
        // Single and double quotes cannot span lines (if one appears to, it is a stray apostrophe, not a string).
        if (c !== "`" && ch === "\n") break;
        j++;
      }
      // With no closing quote found, advance a single character — so the scanner is not swallowed
      // whole by a regex literal or by an apostrophe in JSX text (don't).
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

/** JSX text nodes. Only spans free of braces and angle brackets are collected, so expression
 * interpolation (`{count} items`) is left for the literal pass to catch. A comparison like
 * `a > b < c` gets picked up too, but it comes through as a single space-free token, which the
 * heuristic below filters out. */
function scanJsxText(masked: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of masked.matchAll(/>([^<>{}]+)</g)) {
    const offset = m.index;
    const text = m[1];
    if (offset !== undefined && text !== undefined)
      hits.push({ text, offset: offset + 1, jsx: true });
  }
  return hits;
}

function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/** Copy or code fragment? Korean is almost certainly copy, so it passes first; for English only
 * "looks like a sentence" survives — which means a single-word English label (Save/Retry) inside a
 * component is missed. Since the default locale is `ko`, those labels are still caught on the
 * Korean side, so this is a deliberate trade-off. */
function classify(text: string, jsx: boolean): boolean {
  const s = text.trim();
  if (s.length === 0) return false;
  if (HEX_RE.test(s) || FILE_RE.test(s)) return false; // color value / filename
  if (s.includes("://") || s.startsWith("/") || s.startsWith("./") || s.startsWith("../"))
    return false; // URL or path
  if (HANGUL_RE.test(s)) return true;
  if (!/[A-Za-z]{2}/.test(s)) return false;

  // className/identifier: no whitespace, all lowercase, containing a separator (-, :, /) —
  // tailwind is the typical case. The lowercase condition keeps a hyphenated word that starts with
  // a capital ("Read-only") alive.
  if (!/\s/.test(s) && s === s.toLowerCase() && /[-:/]/.test(s)) return false;

  // A single-word English string is treated as a technical token (key name, enum value, ...).
  if (jsx) return s.length > 1 && /^[A-Z]/.test(s);
  return s.length > 3 && /\s/.test(s) && /^[A-Z]/.test(s);
}

/** The nearest preceding component declaration name. Falls back to the filename when none is found. */
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

/** Guess the on-screen role from the text just before/after the literal — it becomes the middle segment of the key name. */
function roleOf(src: string, hit: Hit): string {
  const before = src.slice(Math.max(0, hit.offset - 40), hit.offset);
  if (/placeholder\s*=\s*["']?$/.test(before)) return "placeholder";
  if (/aria-label\s*=\s*["']?$/.test(before)) return "ariaLabel";
  if (/(?:title|alt|label)\s*=\s*["']?$/.test(before)) return "title";
  const after = src.slice(hit.offset, hit.offset + 160);
  if (/^\s*["'`]?\s*\}?\s*,?\s*[\s\S]{0,60}?on(?:Click|Press|Submit|Change)\b/.test(after))
    return "button";
  return hit.jsx ? "label" : "text";
}

function camel(words: readonly string[]): string {
  return words
    .map((w, i) =>
      i === 0 ? (w[0] ?? "").toLowerCase() + w.slice(1) : (w[0] ?? "").toUpperCase() + w.slice(1),
    )
    .join("");
}

/** Lowercase a name so it can serve as a key segment: `Inbox` → `inbox`, `FILTERS` → `filters`,
 * `TOOL_LABELS` → `toolLabels`. Plainly lowercasing a constant name would yield `fILTERS`. */
function decap(name: string): string {
  if (name === name.toUpperCase())
    return camel(
      name
        .toLowerCase()
        .split("_")
        .filter((w) => w.length > 0),
    );
  return (name[0] ?? "").toLowerCase() + name.slice(1);
}

/** Guess the leaf name from the ASCII words inside the string. Korean copy has no ASCII and falls
 * back to the line number, which is intentional — `l140` is more honest than a key that force-
 * romanizes Hangul, and a human renames it while migrating anyway. */
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
  // The dictionary itself is not a target — every string in it is already i18n'd.
  if (rel.startsWith(`${DICTIONARY_DIR}/`)) return [];

  const src = readFileSync(file, "utf8");
  // Wipe comments before running the two passes — the JSX text regex cannot tell a comment apart,
  // so without this a line like `// note … const [` would masquerade as copy.
  const masked = maskComments(src);
  const hits = [...scanLiterals(masked), ...scanJsxText(masked)].sort(
    (a, b) => a.offset - b.offset,
  );

  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!classify(hit.text, hit.jsx)) continue;
    const line = lineAt(src, hit.offset);
    const text = hit.text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
    // The same string twice on one line (a conditional render, say) has no reason to appear twice in the table.
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
    "# i18n Hardcoded Copy Scan Report",
    "",
    "Generated by `tsx tools/i18n/scan.ts` — do not edit by hand (the next run overwrites it).",
    "This report is the result of a **read-only scan**: the script never modifies the sources.",
    "",
    "## Summary",
    "",
    `- Files scanned: ${filesScanned}`,
    `- Candidate strings: ${all.length}`,
    ...SOURCE_DIRS.map((d) => `  - ${d}: ${byDir.get(d) ?? 0}`),
    "",
    "`Suggested key` is a **starting point** built from component name + role",
    "(placeholder/ariaLabel/button/text) + the English words in the string. Korean copy has no",
    "English words and falls back to `l{line}`, on the assumption that a human renames it while",
    "migrating.",
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
    "## Limits of this tool (over- and under-reporting are expected)",
    "",
    "- It is not a full parser. To avoid pulling in a TS parser it uses a state machine that walks",
    "  only comments, strings and templates.",
    "- False positives: a comparison that looks like JSX (`a > b < c`), quotes inside a regex",
    "  literal, and phantom strings produced by apostrophes. The whitespace/capital heuristics",
    "  filter out most of them, but not all.",
    "- Missed: a one-word English label (Save, Retry) is discarded as a technical token. Since the",
    "  default locale is `ko`, the same button is still caught on the Korean side, so this trade-off",
    "  is deliberate.",
    "- Missed: `packages/ui/src/i18n/**` (the dictionary), `*.test.ts(x)`, `node_modules` and `dist`",
    "  are not targets.",
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
