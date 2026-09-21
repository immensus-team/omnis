import { useSyncExternalStore } from "react";

// US-D08 §c.4: "One row open at a time — opening a second closes the first." No row can see its
// siblings — the screen renders them one at a time, through react-virtuoso — so the id of the row
// whose swipe is revealed lives here, outside React, and every row subscribes to it.
//
// Why not lift it into a prop: this is one row's transient gesture state, and the list re-renders
// its whole window of items on every scroll. Lifting it would re-render the list on every pixel of
// a finger's travel, which is the shape of bug the swipe is most likely to ship with.
//
// This is a module singleton, so it outlives any one tree — a test that leaves a row open leaves it
// open for the next one. inbox-row.tsx's unmount effect closes the row it belongs to, which is what
// keeps that honest, and is also what stops a row scrolled out of the list from coming back still
// open.
let openId: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reveal `id`, closing whatever row was revealed before it. */
export function openRow(id: string): void {
  if (openId === id) return;
  openId = id;
  for (const listener of listeners) listener();
}

/** Close `id`. A no-op when another row is the open one — releasing a row that is already shut must
 *  not take the reveal off its neighbour. */
export function closeRow(id: string): void {
  if (openId !== id) return;
  openId = null;
  for (const listener of listeners) listener();
}

/** True while this row is the revealed one. The snapshot is a boolean rather than the id, so React
 *  compares it by value and no row re-renders when a different row opens or closes. */
export function useRowOpen(id: string): boolean {
  return useSyncExternalStore(subscribe, () => openId === id);
}
