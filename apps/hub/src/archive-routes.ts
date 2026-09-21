// US-B32 (delta §7): the Digest screen's two restores. Both are the same kernel primitive —
// `undoArchive` (packages/kernel/src/archive.ts, A4 §9.3/§9.4) — reached with a different ref: one
// names a single item, the other the undo token the nightly digest stamped on every item a group
// covers. Nothing here decides anything, so the two handlers stay in one small module instead of
// growing http.ts; and neither knows about pg, since http.ts partly applies its own pool below.

export interface ArchiveRouteDeps {
  /** `undoArchive` partly applied with the pool and the audit sink; returns the number of items
   *  whose status went back to 'received' (0 when nothing matched — see the tests). */
  undoArchive(ref: { itemId?: string; undoToken?: string }, actor: string): Promise<number>;
}

/** POST /items/:id/unarchive — A5 §3.8's per-item "Restore". The item id is the whole request: the
 *  7-day window and the thread's 30-day re-archive exclusion are the kernel's business, not a
 *  parameter the screen gets to set. */
export async function handleUnarchiveItem(
  deps: ArchiveRouteDeps,
  itemId: string,
): Promise<{ id: string; status: "received" }> {
  await deps.undoArchive({ itemId }, "me");
  return { id: itemId, status: "received" };
}

/** POST /digests/:id/undo — A5 §3.8's "Restore all" for one category. The token is what identifies
 *  the group (the digest row's own groups carry it), so the path's digest id is only the row the
 *  screen was looking at when the button was pressed. */
export async function handleDigestUndo(
  deps: ArchiveRouteDeps,
  undoToken: string,
): Promise<{ restored: number }> {
  const restored = await deps.undoArchive({ undoToken }, "me");
  return { restored };
}
