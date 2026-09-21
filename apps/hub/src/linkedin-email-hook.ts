// US-C09: the LinkedIn parallel signal (A1 §2.9). The Gmail pipeline already receives LinkedIn's
// notification mail, so the "new message arrived" ping comes almost for free — no second login and
// no second account linking. This hook turns one matching Gmail item into one more item on the
// `linkedin` account; the message body itself still needs the Playwright adapter (US-C10).
import { parseNotificationEmail } from "@omnis/adapter-linkedin";
import type { AdapterEvent, IngestSink, NormalizedItem } from "@omnis/protocol";

export interface LinkedInEmailHookDeps {
  /** The `linkedin` account row's id, or null when that channel is not set up yet (no Playwright
   *  profile has been created — US-C10). */
  findLinkedInAccount(): Promise<string | null>;
  /** The real ingest sink. The original item goes through it first and unchanged. */
  sink: IngestSink;
}

function isItem(e: NormalizedItem | AdapterEvent): e is NormalizedItem {
  return "threadExternalId" in e;
}

/** Wraps the hub's ingest sink: after a Gmail item is stored, a LinkedIn message notification may
 *  emit one more item on the `linkedin` account. Everything else — invites, job alerts, other mail,
 *  and every adapter event — passes straight through. */
export function linkedinFromGmail(deps: LinkedInEmailHookDeps): IngestSink {
  return async (accountId, e) => {
    await deps.sink(accountId, e);
    if (!isItem(e)) return;
    const derived = parseNotificationEmail(e);
    if (derived === null) return;
    // Parsed before the lookup: only LinkedIn's own mail reaches this line, so a per-message accounts
    // query in front of every Gmail item would be paid by the whole inbox for one channel's signal.
    const linkedInAccountId = await deps.findLinkedInAccount();
    if (linkedInAccountId === null) return;
    await deps.sink(linkedInAccountId, derived);
  };
}
