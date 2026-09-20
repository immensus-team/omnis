// A2 §3.2 ingest RPC + A4 §10 메모리 소스 값 집합. 델타 §2.1에서 그대로 옮긴다.
import { z } from "zod";

export const IngestScanParams = z.object({
  roots: z.array(z.string()).min(1),
  since: z.string().datetime().optional(),
});
export const IngestScanResult = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      size: z.number().int(),
      mtime: z.string().datetime(),
      sha256: z.string(),
    }),
  ),
  truncated: z.boolean(),
});
export const IngestReadParams = z.object({
  path: z.string(),
  max_bytes: z.number().int().positive().default(1_048_576), // 기본 1MB (A2 §3.2)
});
export const IngestReadResult = z.object({
  path: z.string(),
  mtime: z.string().datetime(),
  bytes: z.number().int(),
  content_b64: z.string(),
  truncated: z.boolean(),
});
export type IngestScanParams = z.infer<typeof IngestScanParams>;
export type IngestScanResult = z.infer<typeof IngestScanResult>;
export type IngestReadParams = z.infer<typeof IngestReadParams>;
export type IngestReadResult = z.infer<typeof IngestReadResult>;

export const MemorySourceKind = z.enum(["inbox", "calendar", "file", "drive", "github", "self"]);
export const MemoryKind = z.enum(["fact", "preference", "commitment", "event", "summary"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKind>;
export type MemoryKind = z.infer<typeof MemoryKind>;

// A4 §10.2 하드 제외. allowlist보다 **먼저** 걸린다. 경로만 보고 판단한다 — 내용을 보고
// 판단하려면 이미 읽은 뒤이기 때문이다.
// 허브(@omnis/memory)와 브리지(apps/local-agent)가 같은 배열을 쓴다. 두 목록이 갈리면
// 그 차이가 곧 유출 경로라서 정의를 이 리프 패키지에 둔다.
export const DENY_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx|keychain)$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.|$)/,
  /(^|\/)\.(npmrc|netrc)$/,
  /(^|\/)\.aws\//,
  /(^|\/)\.ssh\//,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.config\/gh\//,
  /(^|\/)credentials[^/]*$/i,
  /\.sqlite-wal$/,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.venv\//,
  /(^|\/)__pycache__\//,
  /\.(zip|tar|gz|7z|iso|dmg|pkg)$/i,
  /\.(mp4|mov|m4v|avi|mkv)$/i,
] as const;

export const MAX_INGEST_FILE_BYTES = 2_000_000; // A4 §10.2 2MB 상한
const BINARY_SNIFF_BYTES = 8192;

export function isDenied(path: string): boolean {
  return DENY_PATTERNS.some((re) => re.test(path));
}

/** A4 §10.2: 첫 8KB에 NUL 바이트가 있으면 바이너리로 본다. */
export function isBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** ponytail: gitignore 스펙 전체가 아니라 "디렉터리 · 글롭 · 루트 앵커" 세 형태만 본다.
 *  부정(!)과 중첩 .gitignore는 무시한다 — 과다 제외는 이 루프에서 손해가 아니다
 *  (무시되는 파일은 대개 빌드 산출물 아니면 비밀이다, A4 §10.2). */
export function gitignoreMatcher(root: string, gitignore: string): (path: string) => boolean {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const rules: RegExp[] = [];
  for (const rawLine of gitignore.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const anchored = line.startsWith("/");
    const isDir = line.endsWith("/");
    const body = line.replace(/^\//, "").replace(/\/$/, "");
    const escaped = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
    const head = anchored ? "^" : "(^|/)";
    rules.push(new RegExp(`${head}${escaped}(/|$)`));
    if (!isDir && !anchored) rules.push(new RegExp(`(^|/)${escaped}$`));
  }
  return (path: string): boolean => {
    if (!path.startsWith(prefix)) return false;
    const rel = path.slice(prefix.length);
    return rules.some((re) => re.test(rel));
  };
}
