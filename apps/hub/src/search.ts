// US-B26 / A4 §14: unified search. A synchronous four-way fan-out (items FTS + trigram
// fallback, threads roll-up, persons trigram + handle_norm, memories kNN) merged with the
// §14.3 ranking. Deliberately leaves no `agent_runs` row — a search a human typed is not an
// agent run (A4 §14).
import { query } from "@omnis/db";
import { type MemoryHit, searchMemories, truncateSnippet } from "@omnis/memory";
import type {
  Channel,
  SearchGroup,
  SearchGroupKind,
  SearchHit,
  SearchResponse,
} from "@omnis/protocol";
import type { Pool } from "pg";

export interface ItemHitRow {
  id: string;
  thread_id: string;
  subject: string | null;
  body: string;
  sent_at: string;
  channel: Channel;
}
export interface ThreadHitRow {
  id: string;
  title: string | null;
  last_item_at: string | null;
  /** A4 §14.3 gives the vip bump to a thread a VIP takes part in, not just to the person. */
  vip: boolean;
}
export interface PersonHitRow {
  id: string;
  display_name: string;
  last_contact_at: string | null;
  vip: boolean;
}

export interface SearchDeps {
  searchItems(q: string, k: number): Promise<ItemHitRow[]>;
  searchThreads(q: string, itemThreadIds: readonly string[], k: number): Promise<ThreadHitRow[]>;
  searchPeople(q: string, k: number): Promise<PersonHitRow[]>;
  searchMemories(q: string, k: number): Promise<MemoryHit[]>;
}

export interface SearchParams {
  q: string;
  k?: number;
  /** Parsed but not applied yet — A4 §14.2's query table has no scope/since predicate. */
  scope?: "work" | "personal" | "all";
  since?: string;
  now?: Date;
}

const GROUP_WEIGHT: Record<SearchGroupKind, number> = {
  people: 1.0,
  threads: 0.9,
  items: 0.85,
  memories: 0.8,
};
const GROUP_CAP = 5;
const RECENCY_HALF_LIFE_DAYS = 90;
const UNTITLED_THREAD = "(untitled)";

function recency(at: string | null, now: Date): number {
  if (at === null) return 0;
  const ageDays = Math.max(0, (now.getTime() - new Date(at).getTime()) / 86_400_000);
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** A4 §14.3: normalise to 0..1 inside a group. An all-zero group normalises to all zeros. */
export function normalizeScores(raws: readonly number[]): number[] {
  const max = Math.max(0, ...raws);
  if (max === 0) return raws.map(() => 0);
  return raws.map((r) => r / max);
}

export function mergedScore(
  groupWeight: number,
  normRaw: number,
  at: string | null,
  vip: boolean,
  now: Date,
): number {
  return groupWeight * normRaw + 0.25 * recency(at, now) + 0.15 * (vip ? 1 : 0);
}

export function buildGroup(kind: SearchGroupKind, hits: readonly SearchHit[]): SearchGroup {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  return { kind, total: sorted.length, results: sorted.slice(0, GROUP_CAP) };
}

/**
 * SQL ordering is the only raw signal the row queries carry back, so rank position stands in
 * for the raw score: the top row scores 1 after normalisation, the last one 1/n.
 */
function rankScores(n: number): number[] {
  return normalizeScores(Array.from({ length: n }, (_, i) => n - i));
}

export async function runSearch(deps: SearchDeps, params: SearchParams): Promise<SearchResponse> {
  const start = Date.now();
  const k = params.k ?? GROUP_CAP;
  const now = params.now ?? new Date();

  const [itemRows, peopleRows, memoryHits] = await Promise.all([
    deps.searchItems(params.q, k),
    deps.searchPeople(params.q, k),
    deps.searchMemories(params.q, k),
  ]);
  // A4 §14.2: the threads group is the roll-up of the item hits, so it needs their thread ids.
  const threadRows = await deps.searchThreads(
    params.q,
    [...new Set(itemRows.map((r) => r.thread_id))],
    k,
  );

  const peopleNorm = rankScores(peopleRows.length);
  const peopleHits: SearchHit[] = peopleRows.map((r, i) => ({
    kind: "person",
    id: r.id,
    score: mergedScore(GROUP_WEIGHT.people, peopleNorm[i] ?? 0, r.last_contact_at, r.vip, now),
    title: r.display_name,
    snippet: r.display_name,
    at: r.last_contact_at,
    channel: null,
    deep_link: { screen: "person", person_id: r.id },
  }));

  const threadsNorm = rankScores(threadRows.length);
  const threadHits: SearchHit[] = threadRows.map((r, i) => ({
    kind: "thread",
    id: r.id,
    score: mergedScore(GROUP_WEIGHT.threads, threadsNorm[i] ?? 0, r.last_item_at, r.vip, now),
    title: r.title ?? UNTITLED_THREAD,
    snippet: r.title ?? "",
    at: r.last_item_at,
    channel: null,
    deep_link: { screen: "thread", thread_id: r.id },
  }));

  const itemsNorm = rankScores(itemRows.length);
  const itemHits: SearchHit[] = itemRows.map((r, i) => ({
    kind: "item",
    id: r.id,
    score: mergedScore(GROUP_WEIGHT.items, itemsNorm[i] ?? 0, r.sent_at, false, now),
    title: r.subject ?? truncateSnippet(r.body, 60),
    snippet: truncateSnippet(r.subject === null ? r.body : `${r.subject} — ${r.body}`),
    at: r.sent_at,
    channel: r.channel,
    deep_link: { screen: "thread", thread_id: r.thread_id, item_id: r.id },
  }));

  const memoriesNorm = normalizeScores(memoryHits.map((m) => m.score));
  const memoryHitViews: SearchHit[] = memoryHits.map((m, i) => ({
    kind: "memory",
    id: m.memory_id,
    score: mergedScore(GROUP_WEIGHT.memories, memoriesNorm[i] ?? 0, m.recorded_at, false, now),
    title: truncateSnippet(m.content, 60),
    snippet: truncateSnippet(m.content),
    at: m.recorded_at,
    channel: null,
    deep_link: m.source_item_id === null ? null : { screen: "thread", item_id: m.source_item_id },
    source_kind: m.source_kind,
  }));

  const groups: SearchGroup[] = [
    buildGroup("people", peopleHits),
    buildGroup("threads", threadHits),
    buildGroup("items", itemHits),
    buildGroup("memories", memoryHitViews),
  ];

  return {
    q: params.q,
    took_ms: Date.now() - start,
    groups,
    truncated: groups.some((g) => g.total > g.results.length),
  };
}

interface ItemRow extends Omit<ItemHitRow, "sent_at"> {
  sent_at: Date;
}
interface ThreadRow extends Omit<ThreadHitRow, "last_item_at"> {
  last_item_at: Date | null;
}
interface PersonRow extends Omit<PersonHitRow, "last_contact_at"> {
  last_contact_at: Date | null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** The real SQL wiring — A4 §14.2's query table. The trigram fallback only fires on 0 FTS hits. */
export function createSearchDeps(pool: Pool): SearchDeps {
  return {
    async searchItems(q, k) {
      const fts = await query<ItemRow>(
        pool,
        `SELECT i.id, i.thread_id, i.subject, i.body, i.sent_at, a.channel
           FROM items i JOIN accounts a ON a.id = i.account_id
          WHERE i.search_tsv @@ websearch_to_tsquery('simple', $1)
          ORDER BY ts_rank(i.search_tsv, websearch_to_tsquery('simple', $1)) DESC
          LIMIT $2`,
        [q, k],
      );
      const rows =
        fts.length > 0
          ? fts
          : await query<ItemRow>(
              pool,
              `SELECT i.id, i.thread_id, i.subject, i.body, i.sent_at, a.channel
                 FROM items i JOIN accounts a ON a.id = i.account_id
                WHERE similarity(i.body, $1) > 0.3
                ORDER BY similarity(i.body, $1) DESC
                LIMIT $2`,
              [q, k],
            );
      return rows.map((r) => ({ ...r, sent_at: r.sent_at.toISOString() }));
    },

    async searchThreads(q, itemThreadIds, k) {
      const rows = await query<ThreadRow>(
        pool,
        `SELECT t.id, t.title, t.last_item_at,
                EXISTS (SELECT 1 FROM persons p
                         WHERE p.id = ANY(t.participants) AND p.vip) AS vip
           FROM threads t
          WHERE t.id = ANY($2::uuid[]) OR similarity(coalesce(t.title, ''), $1) > 0.3
          ORDER BY (t.id = ANY($2::uuid[])) DESC, similarity(coalesce(t.title, ''), $1) DESC
          LIMIT $3`,
        [q, itemThreadIds, k],
      );
      return rows.map((r) => ({ ...r, last_item_at: iso(r.last_item_at) }));
    },

    async searchPeople(q, k) {
      const rows = await query<PersonRow>(
        pool,
        `SELECT p.id, p.display_name, p.last_contact_at, p.vip
           FROM persons p
          WHERE p.merged_into IS NULL
            AND (similarity(p.display_name, $1) > 0.2
              OR EXISTS (SELECT 1 FROM identities idn
                          WHERE idn.person_id = p.id AND idn.handle_norm = $1))
          ORDER BY similarity(p.display_name, $1) DESC
          LIMIT $2`,
        [q, k],
      );
      return rows.map((r) => ({ ...r, last_contact_at: iso(r.last_contact_at) }));
    },

    async searchMemories(q, k) {
      return searchMemories(pool, { query: q, k });
    },
  };
}
