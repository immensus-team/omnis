// Every write goes through the hub's HTTP boundary (contract §5) — Zero is read-only.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** US-A36 manual archive/restore. On success the hub changes threads.archived_at and Zero pushes it
 *  out to every client. */
export async function setThreadArchived(id: string, archived: boolean): Promise<void> {
  const verb = archived ? "archive" : "unarchive";
  const res = await fetch(`${HUB_HTTP_URL}/api/threads/${id}/${verb}`, { method: "POST" });
  if (!res.ok) throw new Error(`thread ${verb} failed: HTTP ${res.status}`);
}

/** loop-r2-02: throw away a draft that no approval is about. The hub archives it (status='archived')
 *  if it is still a `draft`, and answers 404 when it is not — a message that has already reached the
 *  channel is not something this call can take back.
 *
 *  It is a hub route rather than a Zero mutation because `zero-schema.ts` grants no write
 *  permissions: the old `zero.mutate.items.update(...)` on the draft card was rejected by the server
 *  and failed silently, which is what the testers saw as a Discard that did nothing. */
export async function discardDraft(itemId: string): Promise<void> {
  const res = await fetch(`${HUB_HTTP_URL}/api/items/${itemId}/discard`, { method: "POST" });
  if (!res.ok) throw new Error(`draft discard failed: HTTP ${res.status}`);
}
