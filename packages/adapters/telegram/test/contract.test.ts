import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedItem } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { mapApiError, normalize } from "../src/index.js";

interface Fixture {
  scenario: string;
  raw: unknown;
  expected: { items?: unknown[]; errorKind?: string };
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map(
    (file) => [file, JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture] as const,
  );

describe("Telegram contract: fixture replay", () => {
  for (const [file, fixture] of fixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      if (fixture.expected.errorKind) {
        const err = mapApiError(fixture.raw);
        expect(err.kind).toBe(fixture.expected.errorKind);
      } else {
        expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
      }
    });
  }
});

// The replay loop above pins down "this raw becomes exactly this item" for each fixture. This block is
// the inverse: invariants on the item itself that must keep holding as fixtures are added — the kernel
// consumes this shape, so an item from any fixture has to satisfy them. Since the replay loop already
// nailed down expected === normalize(raw), checking expected.items here is equivalent to checking the
// real normalize() output (and it also blocks a bogus item being hand-written into a fixture).
describe("Telegram contract: NormalizedItem invariants", () => {
  const itemFixtures = fixtures.filter(([, f]) => f.expected.items !== undefined);
  const produced = itemFixtures.flatMap(([file, f]) =>
    (f.expected.items ?? []).map((item, index) => ({
      file,
      index,
      item: item as NormalizedItem,
    })),
  );

  // If the filter were wrong and left zero items to check, the loop below would pass silently — this
  // closes that hole.
  it("has items to check", () => {
    expect(produced.length).toBeGreaterThan(0);
  });

  for (const { file, index, item } of produced) {
    it(`${file}#${index} → ${item.externalId ?? "(no externalId)"}`, () => {
      expect(typeof item.externalId).toBe("string");
      expect(item.externalId).not.toBe("");
      expect(typeof item.threadExternalId).toBe("string");
      expect(item.threadExternalId).not.toBe("");

      // Check that it reads as ISO-8601 and keeps the same `.SSSZ` round-trip format as the other
      // adapters.
      expect(new Date(item.sentAt).toString()).not.toBe("Invalid Date");
      expect(new Date(item.sentAt).toISOString()).toBe(item.sentAt);

      expect(item.author).toBeDefined();
      expect(typeof item.author?.kind).toBe("string");
      expect(item.author?.kind).not.toBe("");

      // If the body is empty, the attachments have to be that item's content — if both are empty the
      // item carries nothing the kernel can use (the same reason normalize() drops such raws).
      const attachments = item.attachments ?? [];
      expect(item.body.length > 0 || attachments.length > 0).toBe(true);
      for (const attachment of attachments) {
        expect(attachment.kind).toBeTruthy();
      }

      if (item.threadMeta !== undefined) {
        expect(item.threadMeta.externalId).toBeTruthy();
        expect(item.threadMeta.kind).toBeTruthy();
      }
    });
  }
});
