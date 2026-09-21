import type { UiChannel } from "../types.js";
import { CHANNEL_LABEL } from "./row-meta.js";

// D7 §c.2: the rail's tile order. Modelled on lib/ask-model.ts — same try/catch-and-ignore shape,
// same one-key-one-value scope, no general storage abstraction (YAGNI).
//
// The hub has no settings HTTP route (packages/kernel/src/settings.ts is pool-only and SettingKey
// has no ui.* member), and adding one is backend work outside a design wave. localStorage is the
// store; when a settings route exists, this file is the single place that moves to `ui.rail_order`.
export const RAIL_ORDER_STORAGE_KEY = "omnis.rail-order";

/** The channel ids the union actually carries, read off the label map rather than restated as a
 *  second list — a new channel then cannot be added to `UiChannel` and forgotten here. */
const CHANNEL_IDS = Object.keys(CHANNEL_LABEL) as UiChannel[];

/** The stored order, or `[]` when there is none. A stored id that is not a channel any more is
 *  dropped here rather than at apply time, so what comes back is always a list of real channels.
 *  Every read is guarded: an environment where touching localStorage throws (Safari private mode)
 *  renders the rail in its default order instead of taking the shell down with it. */
export function readRailOrder(): UiChannel[] {
  try {
    const raw = localStorage.getItem(RAIL_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is UiChannel => CHANNEL_IDS.includes(id as UiChannel));
  } catch {
    return [];
  }
}

/** A failed write is ignored — this session's order is still live on screen, and the next run comes
 *  back to the default order. */
export function writeRailOrder(order: readonly UiChannel[]): void {
  try {
    localStorage.setItem(RAIL_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

/** The connected tiles in the stored order.
 *
 *  - ids the hub no longer reports (an account was disconnected) are dropped;
 *  - a channel that is not in the stored list yet — a newly connected account — is appended, in
 *    the order the hub reported it, so it lands at the end rather than nowhere;
 *  - a duplicate in the store (hand-edited, or two writes racing) is kept once.
 *
 *  Pure and total: any stored list at all produces a permutation of `tiles`. */
export function applyOrder(tiles: readonly UiChannel[], stored: readonly UiChannel[]): UiChannel[] {
  const present = new Set(tiles);
  const ordered: UiChannel[] = [];
  for (const id of stored) {
    if (present.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of tiles) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/** Moves one tile one slot, returning the new order — the keyboard path (§c.2), and the same
 *  splice the pointer path commits. Out-of-range moves return the input unchanged, so a tile at the
 *  end of the rail is a no-op rather than a wrap-around. */
export function moveTile(order: readonly UiChannel[], id: UiChannel, delta: number): UiChannel[] {
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
