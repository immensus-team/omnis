// Writes all go through hub HTTP (contract §5) — Zero is read-only, and so is search.
import type { UiSearchGroup, UiSearchGroupKind, UiSearchHit } from "@omnis/ui";

// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list (contract review M11); when it is
// unset at build time the local default is used.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** Phase B interfaces delta §2.2 (A4 §14.4). A local mirror of `@omnis/protocol`'s SearchResponse:
 *  the desktop app does not depend on that package, and the palette's types are mirrored the same
 *  way in @omnis/ui. Keep in step with packages/protocol/src/search.ts. */
export interface SearchDeepLink {
  screen: "thread" | "person" | "digest";
  thread_id?: string;
  item_id?: string;
  person_id?: string;
}
export interface SearchHit {
  kind: "person" | "thread" | "item" | "memory";
  id: string;
  score: number;
  title: string;
  snippet: string;
  at: string | null;
  channel: string | null;
  deep_link: SearchDeepLink | null;
  source_kind?: string;
}
export interface SearchGroup {
  kind: "people" | "threads" | "items" | "memories";
  total: number;
  results: SearchHit[];
}
export interface SearchResponse {
  q: string;
  took_ms: number;
  groups: SearchGroup[];
  truncated: boolean;
}

export async function search(
  q: string,
  opts?: { k?: number; scope?: "work" | "personal" | "all"; since?: string },
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  if (opts?.k !== undefined) params.set("k", String(opts.k));
  if (opts?.scope !== undefined) params.set("scope", opts.scope);
  if (opts?.since !== undefined) params.set("since", opts.since);
  const res = await fetch(`${HUB_HTTP_URL}/search?${params.toString()}`);
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
  return res.json();
}

const GROUP_LABELS: Record<UiSearchGroupKind, string> = {
  people: "People",
  threads: "Threads",
  items: "Items",
  memories: "Memories",
};

/** US-B27: the hub's response → what the palette renders. A memory with no `deep_link` is the one
 *  case A5 §2.5 calls out as unclickable; the palette's own order array fixes the group order, so
 *  the hub's order is not preserved here. `sourceKind` is only ever set on a memory hit (the hub
 *  leaves it out everywhere else), and the palette has to read "absent" as "no badge" rather than
 *  as an empty badge. */
export function toUiSearchGroups(response: SearchResponse): UiSearchGroup[] {
  return response.groups.map((group) => ({
    kind: group.kind,
    label: GROUP_LABELS[group.kind],
    results: group.results.map(
      (result): UiSearchHit => ({
        kind: result.kind,
        id: result.id,
        title: result.title,
        snippet: result.snippet,
        deepLinkDisabled: result.deep_link === null,
        sourceKind: result.source_kind ?? null,
      }),
    ),
  }));
}
