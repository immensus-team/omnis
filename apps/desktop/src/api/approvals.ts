// OMNIS_HUB_HTTP_URL: named in interface contract §9's environment-variable list (contract review
// M11) — an unset build falls back to the local default.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** loop-r1-06: the decide endpoint's address, exported because a second caller has to name it —
 *  the shell's `beforeunload` flush, which sends a deferred ignore with `navigator.sendBeacon` and
 *  cannot go through `decideApproval` (a fetch is cancelled when the document goes away). One path,
 *  two ways of posting to it. */
export function approvalDecideUrl(id: string): string {
  return `${HUB_HTTP_URL}/approvals/${id}/decide`;
}

export async function decideApproval(
  id: string,
  decision: "accept" | "edit" | "respond" | "ignore",
  decidedArgs?: Record<string, unknown>,
): Promise<{ id: string; state: "decided" }> {
  const res = await fetch(approvalDecideUrl(id), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, decided_args: decidedArgs }),
  });
  if (!res.ok) throw new Error(`approval decide failed: HTTP ${res.status}`);
  return res.json();
}
