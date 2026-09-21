// US-B32's two writes. Both are hub HTTP (contract §5) — Zero is read-only, and the digest screen
// reads the digest row through it while restoring through these.
//
// OMNIS_HUB_HTTP_URL is on the interface contract §9 env list; when it is unset at build time the
// local default is used (the same line notes.ts and approvals.ts carry).
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** A5 §3.8's per-item "Restore": back to the Inbox. The hub answers with the item and its new
 *  status, which is always 'received' — the item's 7-day undo window is the hub's to check, not
 *  this client's. */
export async function unarchiveItem(id: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${HUB_HTTP_URL}/items/${id}/unarchive`, { method: "POST" });
  if (!res.ok) throw new Error(`unarchive failed: HTTP ${res.status}`);
  return res.json();
}

/** A5 §3.8's "Restore all" for one category. The token comes off the digest's own group
 *  (`digests.body` → `auto_archived[].undo_token`), and it is the whole request: the hub matches it
 *  against the items that carry it. `restored` is how many came back — 0 is a real answer for a
 *  group a human already restored, or one older than the 7-day window. */
export async function undoDigestGroup(
  digestId: string,
  undoToken: string,
): Promise<{ restored: number }> {
  const res = await fetch(`${HUB_HTTP_URL}/digests/${digestId}/undo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ undo_token: undoToken }),
  });
  if (!res.ok) throw new Error(`digest undo failed: HTTP ${res.status}`);
  return res.json();
}
