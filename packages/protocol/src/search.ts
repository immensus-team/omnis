import { z } from "zod";
import { Channel } from "./adapter.js";
import { MemorySourceKind } from "./ingest.js";

/** Phase B interfaces delta §2.2 (A4 §14.4). Unified search contract for GET /search. */
export const SearchHitKind = z.enum(["person", "thread", "item", "memory"]);
export type SearchHitKind = z.infer<typeof SearchHitKind>;

/** Group order is fixed by A4 §14.3 group_weight: people, threads, items, memories. */
export const SearchGroupKind = z.enum(["people", "threads", "items", "memories"]);
export type SearchGroupKind = z.infer<typeof SearchGroupKind>;

/** The client routes this verbatim (A5 §2.5). Null when a memory has no source item. */
export const SearchDeepLink = z.object({
  screen: z.enum(["thread", "person", "digest"]),
  thread_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  person_id: z.string().uuid().optional(),
});
export type SearchDeepLink = z.infer<typeof SearchDeepLink>;

export const SearchHit = z.object({
  kind: SearchHitKind,
  id: z.string().uuid(),
  score: z.number(),
  title: z.string(),
  snippet: z.string().max(160),
  at: z.string().datetime().nullable(),
  channel: Channel.nullable(),
  deep_link: SearchDeepLink.nullable(),
  source_kind: MemorySourceKind.optional(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchGroup = z.object({
  kind: SearchGroupKind,
  /** Count before the per-group cap of 5 (A4 §14.3). */
  total: z.number().int(),
  results: z.array(SearchHit),
});
export type SearchGroup = z.infer<typeof SearchGroup>;

export const SearchResponse = z.object({
  q: z.string(),
  took_ms: z.number().int(),
  groups: z.array(SearchGroup),
  /** True when any group hit the cap. */
  truncated: z.boolean(),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
