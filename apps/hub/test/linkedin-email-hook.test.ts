import type { AdapterEvent, IngestSink, NormalizedItem } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { linkedinFromGmail } from "../src/linkedin-email-hook.js";

const GMAIL_ACCOUNT = "11111111-1111-4111-8111-111111111111";
const LINKEDIN_ACCOUNT = "22222222-2222-4222-8222-222222222222";

/** A LinkedIn message notification as the Gmail adapter emits it (same shape as the adapter's
 *  fixtures; kept local so the hub test does not reach into another package's fixture directory). */
function gmailItem(over: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    threadExternalId: "19bc4f2a3d5e6f70",
    externalId: "19bc4f2a3d5e6f70",
    kind: "email",
    author: { kind: "person", id: "messages-noreply@linkedin.com" },
    body: 'Subject: Dana Lee sent you a message\n\nDana Lee sent you a message on LinkedIn.\n\n"Let\'s sync tomorrow at 10am about the launch plan."\n\nView message: https://www.linkedin.com/messaging/thread/2-YWJjMTIz/\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2',
    attachments: [],
    sentAt: "2026-09-22T09:14:03.000Z",
    status: "received",
    sourceHash: "<li-msg-001@linkedin.com>",
    threadMeta: {
      externalId: "19bc4f2a3d5e6f70",
      kind: "email",
      title: "Dana Lee sent you a message",
      participants: [
        { externalId: "messages-noreply@linkedin.com", displayName: "LinkedIn" },
        { externalId: "logan@example.com", displayName: "Logan Kim" },
      ],
      lastItemAt: "2026-09-22T09:14:03.000Z",
      archivedAt: null,
    },
    ...over,
  };
}

function recordingSink(): {
  calls: Array<{ accountId: string; e: NormalizedItem | AdapterEvent }>;
  sink: IngestSink;
} {
  const calls: Array<{ accountId: string; e: NormalizedItem | AdapterEvent }> = [];
  return {
    calls,
    sink: async (accountId, e) => {
      calls.push({ accountId, e });
    },
  };
}

describe("linkedinFromGmail (US-C09)", () => {
  it("emits a second item on the linkedin account for a message notification", async () => {
    const { calls, sink } = recordingSink();
    const mail = gmailItem();
    const hook = linkedinFromGmail({
      findLinkedInAccount: async () => LINKEDIN_ACCOUNT,
      sink,
    });

    await hook(GMAIL_ACCOUNT, mail);

    expect(calls).toHaveLength(2);
    // The Gmail item itself is stored first and unchanged — the LinkedIn item is an addition, never
    // a replacement (the email stays in the inbox as mail).
    expect(calls[0]).toEqual({ accountId: GMAIL_ACCOUNT, e: mail });
    const derived = calls[1]?.e as NormalizedItem;
    expect(calls[1]?.accountId).toBe(LINKEDIN_ACCOUNT);
    expect(derived.threadExternalId).toBe("li:2-YWJjMTIz");
    expect(derived.externalId).toBe("li-email:19bc4f2a3d5e6f70");
    expect(derived.sourceHash).toBe("li-email:<li-msg-001@linkedin.com>");
    expect(derived.body).toBe("Let's sync tomorrow at 10am about the launch plan.");
    expect(derived.threadMeta?.title).toBe("Dana Lee");
  });

  it("only forwards when no linkedin account exists", async () => {
    const { calls, sink } = recordingSink();
    const findLinkedInAccount = vi.fn(async () => null);
    const hook = linkedinFromGmail({ findLinkedInAccount, sink });

    await hook(GMAIL_ACCOUNT, gmailItem());

    expect(calls).toHaveLength(1);
    expect(findLinkedInAccount).toHaveBeenCalled();
  });

  it("never looks up the linkedin account for other mail", async () => {
    const { calls, sink } = recordingSink();
    const findLinkedInAccount = vi.fn(async () => LINKEDIN_ACCOUNT);
    const hook = linkedinFromGmail({ findLinkedInAccount, sink });

    await hook(GMAIL_ACCOUNT, gmailItem({ author: { kind: "person", id: "dana@example.com" } }));

    expect(calls).toHaveLength(1);
    expect(findLinkedInAccount).not.toHaveBeenCalled();
  });

  it("never turns a LinkedIn invite or job alert into an item", async () => {
    const { calls, sink } = recordingSink();
    const hook = linkedinFromGmail({ findLinkedInAccount: async () => LINKEDIN_ACCOUNT, sink });

    await hook(
      GMAIL_ACCOUNT,
      gmailItem({
        author: { kind: "person", id: "invitations@linkedin.com" },
        body: "Subject: Dana Lee wants to connect\n\nDana Lee sent you an invitation to connect on LinkedIn.\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2",
      }),
    );

    expect(calls).toHaveLength(1);
  });

  it("forwards adapter events untouched", async () => {
    const { calls, sink } = recordingSink();
    const findLinkedInAccount = vi.fn(async () => LINKEDIN_ACCOUNT);
    const hook = linkedinFromGmail({ findLinkedInAccount, sink });
    const event: AdapterEvent = { kind: "connected", at: "2026-09-22T09:00:00.000Z" };

    await hook(GMAIL_ACCOUNT, event);

    expect(calls).toEqual([{ accountId: GMAIL_ACCOUNT, e: event }]);
    expect(findLinkedInAccount).not.toHaveBeenCalled();
  });
});
