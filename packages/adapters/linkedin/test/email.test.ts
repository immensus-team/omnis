import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type NormalizedItem,
  NormalizedItem as NormalizedItemSchema,
  type NormalizedThread,
} from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { parseNotificationEmail } from "../src/index.js";

interface Fixture {
  scenario: string;
  provenance: string;
  raw: unknown;
  expected: { item: unknown };
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map(
    (file) => [file, JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture] as const,
  );

const baseThreadMeta: NormalizedThread = {
  externalId: "19bc4f2a3d5e6f70",
  kind: "email",
  title: "Dana Lee sent you a message",
  participants: [
    { externalId: "messages-noreply@linkedin.com", displayName: "LinkedIn" },
    { externalId: "logan@example.com", displayName: "Logan Kim" },
  ],
  lastItemAt: "2026-09-22T09:14:03.000Z",
  archivedAt: null,
};

/** A Gmail-normalized LinkedIn notification, as @omnis/adapter-gmail would emit it. */
const base: NormalizedItem = {
  threadExternalId: "19bc4f2a3d5e6f70",
  externalId: "19bc4f2a3d5e6f70",
  kind: "email",
  author: { kind: "person", id: "messages-noreply@linkedin.com" },
  body: 'Subject: Dana Lee sent you a message\n\nDana Lee sent you a message on LinkedIn.\n\n"Let\'s sync tomorrow at 10am about the launch plan."\n\nView message: https://www.linkedin.com/messaging/thread/2-YWJjMTIz/\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2',
  attachments: [],
  sentAt: "2026-09-22T09:14:03.000Z",
  status: "received",
  sourceHash: "<li-msg-001@linkedin.com>",
  threadMeta: baseThreadMeta,
};

describe("LinkedIn contract: fixture replay (A1 §2.9)", () => {
  for (const [file, fixture] of fixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      // The raw side is a NormalizedItem, not a raw Gmail payload. Parsing it through the protocol
      // schema keeps a fixture from drifting away from what the Gmail adapter really emits — a
      // hand-written item that no adapter could produce would fail here, not silently pass.
      expect(NormalizedItemSchema.parse(fixture.raw)).toBeTruthy();
      expect(parseNotificationEmail(NormalizedItemSchema.parse(fixture.raw))).toEqual(
        fixture.expected.item,
      );
    });
  }

  it("covers every scenario the phase-C plan names", () => {
    const scenarios = fixtures.map(([, f]) => f.scenario);
    for (const required of [
      "new_message",
      "new_message_no_preview",
      "connection_invite_ignored",
      "job_alert_ignored",
      "not_linkedin",
    ]) {
      expect(scenarios).toContain(required);
    }
  });

  it("labels every fixture as synthetic-from-docs until spike A1-⑧ replaces them", () => {
    for (const [file, fixture] of fixtures) {
      expect(fixture.provenance, file).toBe("synthetic-from-docs");
    }
  });
});

describe("LinkedIn parseNotificationEmail()", () => {
  it("maps a message notification to a dm thread keyed by conversation id", () => {
    const item = parseNotificationEmail(base);
    expect(item?.threadExternalId).toBe("li:2-YWJjMTIz");
    expect(item?.externalId).toBe("li-email:19bc4f2a3d5e6f70");
    expect(item?.kind).toBe("message");
    expect(item?.author).toEqual({
      kind: "person",
      id: "https://www.linkedin.com/in/dana-lee-8b1c2",
    });
    expect(item?.body).toBe("Let's sync tomorrow at 10am about the launch plan.");
    expect(item?.sourceHash).toBe("li-email:<li-msg-001@linkedin.com>");
    expect(item?.threadMeta?.title).toBe("Dana Lee");
    expect(item?.threadMeta?.kind).toBe("dm");
  });

  // A1 §2.9 lists the profile URL as the sender identity and the conversation id as the thread key.
  // When the mail carries no /messaging/thread/ link the sender alone still identifies the thread —
  // one thread per person, which is how the notification reads.
  it("falls back to the profile slug when the mail has no conversation link", () => {
    const item = parseNotificationEmail({
      ...base,
      body: 'Subject: New message from Dana Lee\n\n"Can you review the deck before Friday?"\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2',
      threadMeta: undefined,
    });
    expect(item?.threadExternalId).toBe("li-email:dana-lee-8b1c2");
    expect(item?.threadMeta?.title).toBe("Dana Lee");
    expect(item?.body).toBe("Can you review the deck before Friday?");
  });

  // Without threadMeta the subject has to come back out of the Gmail body, which prefixes it with
  // "Subject: " (packages/adapters/gmail/src/index.ts normalize()).
  it("reads the subject out of the Gmail body when threadMeta is missing", () => {
    const item = parseNotificationEmail({ ...base, threadMeta: undefined });
    expect(item?.threadMeta?.title).toBe("Dana Lee");
  });

  it("caps the preview at 300 characters", () => {
    const item = parseNotificationEmail({
      ...base,
      body: `Subject: Dana Lee sent you a message\n\n"${"a".repeat(400)}"\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2`,
    });
    expect(item?.body).toBe("a".repeat(300));
  });

  it("ignores regional hosts when it canonicalizes the profile identity", () => {
    const item = parseNotificationEmail({
      ...base,
      body: 'Subject: Dana Lee sent you a message\n\n"hi"\n\nhttps://uk.linkedin.com/in/dana-lee-8b1c2',
    });
    expect(item?.author.id).toBe("https://www.linkedin.com/in/dana-lee-8b1c2");
  });

  it("rejects a LinkedIn mail that names no sender profile", () => {
    expect(
      parseNotificationEmail({
        ...base,
        body: "Subject: Dana Lee sent you a message\n\nDana Lee sent you a message on LinkedIn.",
      }),
    ).toBeNull();
  });

  it("only reads emails", () => {
    expect(parseNotificationEmail({ ...base, kind: "message" })).toBeNull();
  });

  // Gmail writes the subject twice — threadMeta.title and the "Subject:" line it prepends to the
  // body. A mail whose two copies disagree must not be read off the friendlier one.
  it("rejects a mail when either subject copy is an invite", () => {
    expect(
      parseNotificationEmail({
        ...base,
        body: "Subject: Dana Lee wants to connect\n\nDana Lee sent you an invitation to connect on LinkedIn.\n\nhttps://www.linkedin.com/in/dana-lee-8b1c2",
      }),
    ).toBeNull();
  });

  it("rejects LinkedIn mail that is neither an invite, an alert, nor a message", () => {
    expect(
      parseNotificationEmail({
        ...base,
        body: "Subject: Your monthly LinkedIn recap\n\nSee your stats.",
        threadMeta: { ...baseThreadMeta, title: "Your monthly LinkedIn recap" },
      }),
    ).toBeNull();
  });
});

// The replay loop pins "this mail becomes exactly this item". This block is the inverse: invariants
// the kernel's ingest sink relies on, checked against every fixture the loop just proved equal.
describe("LinkedIn contract: NormalizedItem invariants", () => {
  const produced = fixtures
    .filter(([, f]) => f.expected.item !== null)
    .map(([file, f]) => ({ file, item: f.expected.item as NormalizedItem }));

  it("has items to check", () => {
    expect(produced.length).toBeGreaterThan(0);
  });

  for (const { file, item } of produced) {
    it(`${file} → ${item.externalId}`, () => {
      expect(item.kind).toBe("message");
      expect(item.externalId).toMatch(/^li-email:./);
      expect(item.sourceHash).toMatch(/^li-email:./);
      expect(item.threadExternalId).toMatch(/^li:/);
      expect(item.author.kind).toBe("person");
      expect(item.author.id).toMatch(/^https:\/\/www\.linkedin\.com\/in\//);

      expect(new Date(item.sentAt).toISOString()).toBe(item.sentAt);
      // body is the preview or "" — the notification's own boilerplate must never leak in as the
      // message text, because the inbox row renders it as the message (A1 §2.9).
      expect(item.body.length).toBeLessThanOrEqual(300);
      expect(item.body).not.toContain("View message:");

      expect(item.threadMeta?.externalId).toBe(item.threadExternalId);
      expect(item.threadMeta?.title).toBeTruthy();
      expect(item.threadMeta?.participants).toEqual([
        { externalId: item.author.id, displayName: item.threadMeta?.title },
      ]);
    });
  }
});
