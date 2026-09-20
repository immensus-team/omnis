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
