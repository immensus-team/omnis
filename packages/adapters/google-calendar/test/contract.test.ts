import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterError } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendarAdapter, normalize } from "../src/index.js";

interface Fixture {
  scenario: string;
  raw: unknown;
  expected: { items?: unknown[]; errorKind?: string };
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
const fixtures = fixtureFiles.map((file) => ({
  file,
  fixture: JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture,
}));

describe("Google Calendar contract: fixture replay", () => {
  for (const { file, fixture } of fixtures) {
    it(`${fixture.scenario} (${file})`, async () => {
      if (fixture.expected.errorKind === "retryable_network") {
        const list = vi.fn().mockRejectedValue(fixture.raw);
        const adapter = createGoogleCalendarAdapter({
          oauthClientId: "id",
          oauthClientSecret: "secret",
          calendarClient: { events: { list } } as never,
        });
        await expect(async () => {
          for await (const _ of adapter.backfill()) void _;
        }).rejects.toMatchObject({ kind: "retryable_network" } satisfies Partial<AdapterError>);
      } else if (fixture.expected.errorKind === "auth_revoked") {
        const adapter = createGoogleCalendarAdapter({
          oauthClientId: "id",
          oauthClientSecret: "secret",
          oauthClient: {
            setCredentials: vi.fn(),
            getAccessToken: vi.fn().mockRejectedValue(fixture.raw),
          } as never,
        });
        await expect(
          adapter.connect({
            channel: "gcal",
            accountExternalId: "acc",
            keychainService: "omnis.gmail.test@example.com",
            keychainAccount: "test@example.com",
          }),
        ).rejects.toMatchObject({ kind: "auth_revoked" });
      } else {
        expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
      }
    });
  }
});

// The minimum contract that must hold for every item this adapter emits into the kernel, regardless of channel.
// Checks the real normalize() output rather than the JSON stored in the fixture — only that way is the
// adapter verified to honor the contract (reading expected.items would make it a self-referential test
// that passes whatever the adapter emits).
interface NormalizedItemShape {
  externalId: unknown;
  threadExternalId: unknown;
  sentAt: unknown;
  body: unknown;
  attachments: unknown;
  author: { kind?: unknown } | undefined;
  threadMeta?: { externalId?: unknown } | undefined;
}

const itemsFixtures = fixtures.filter(({ fixture }) => fixture.expected.items !== undefined);

describe("Google Calendar contract: NormalizedItem invariants", () => {
  for (const { file, fixture } of itemsFixtures) {
    it(`${fixture.scenario} items hold the adapter invariants (${file})`, () => {
      const items = normalize(fixture.raw) as NormalizedItemShape[];

      for (const item of items) {
        // Thread/item identifiers: the keys the kernel uses to group threads and dedupe — must not be empty.
        expect(item.externalId, `${fixture.scenario}: externalId`).toBeTypeOf("string");
        expect(item.externalId, `${fixture.scenario}: externalId`).not.toBe("");
        expect(item.threadExternalId, `${fixture.scenario}: threadExternalId`).toBeTypeOf("string");
        expect(item.threadExternalId, `${fixture.scenario}: threadExternalId`).not.toBe("");

        // sentAt: the reference timestamp for ordering and incremental collection. Must not be an unparseable string.
        const sentAt = item.sentAt as string;
        expect(new Date(sentAt).toString(), `${fixture.scenario}: sentAt`).not.toBe("Invalid Date");

        // This adapter preserves the dateTime string the API returned verbatim, offsets (`+09:00`) and
        // floating times included, so the identity `new Date(sentAt).toISOString() === sentAt` does not
        // hold (see the outlook tests). What is guaranteed here is "it is ISO-8601 datetime notation and
        // the instant is not lost whatever fallback runs" — a fallback leaking description text or an
        // empty string into sentAt gets caught here.
        expect(sentAt, `${fixture.scenario}: sentAt`).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
        );

        // author: always present and kind must be populated (this adapter pins it to system).
        expect(item.author, `${fixture.scenario}: author`).toBeDefined();
        expect(item.author?.kind, `${fixture.scenario}: author.kind`).toBeTypeOf("string");
        expect(item.author?.kind, `${fixture.scenario}: author.kind`).not.toBe("");

        // Never emit an item with nothing to express: it must have a body or an attachment.
        const body = typeof item.body === "string" ? item.body : "";
        const attachments = Array.isArray(item.attachments) ? item.attachments : [];
        expect(
          body.length > 0 || attachments.length > 0,
          `${fixture.scenario}: contentless item ${String(item.externalId)}`,
        ).toBe(true);

        // When threadMeta is present, externalId is required (without it, thread merging breaks).
        if (item.threadMeta !== undefined) {
          expect(
            item.threadMeta.externalId,
            `${fixture.scenario}: threadMeta.externalId`,
          ).toBeTypeOf("string");
          expect(item.threadMeta.externalId, `${fixture.scenario}: threadMeta.externalId`).not.toBe(
            "",
          );
        }
      }
    });
  }

  it("actually exercises items (guards against a vacuous invariant loop)", () => {
    const total = itemsFixtures.reduce((n, { fixture }) => n + normalize(fixture.raw).length, 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
