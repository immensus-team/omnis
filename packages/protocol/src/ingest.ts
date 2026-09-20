// A2 §3.2 ingest RPC + A4 §10 memory source value set. Carried over verbatim from delta §2.1.
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
  max_bytes: z.number().int().positive().default(1_048_576), // default 1MB (A2 §3.2)
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

// A4 §10.2 hard exclusions. These apply **before** the allowlist. The decision is made on the
// path alone — judging by content would require having already read it.
// The hub (@omnis/memory) and the bridge (apps/local-agent) share this array. If the two lists
// diverged, that difference would itself be an exfiltration path, so the definition lives in
// this leaf package.
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

export const MAX_INGEST_FILE_BYTES = 2_000_000; // A4 §10.2 2MB cap
const BINARY_SNIFF_BYTES = 8192;

export function isDenied(path: string): boolean {
  return DENY_PATTERNS.some((re) => re.test(path));
}

/** A4 §10.2: a NUL byte within the first 8KB means the file is binary. */
export function isBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/** ponytail: not the full gitignore spec, just the three forms "directory · glob · root
 *  anchor". Negation (!) and nested .gitignore files are ignored — over-excluding costs
 *  nothing in this loop (an ignored file is usually a build artifact or a secret, A4 §10.2). */
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
