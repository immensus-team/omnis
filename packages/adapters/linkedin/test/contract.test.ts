import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedItem } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { mapError, normalize } from "../src/index.js";

interface Fixture {
  scenario: string;
  provenance: string;
  note: string;
  raw: unknown;
  expected: { items?: unknown[]; errorKind?: string };
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
/** Only the extracted-DOM fixtures: the US-C09 notification-email fixtures share this directory and
 *  have their own `new_message`-style scenarios. */
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.startsWith("dom_") && f.endsWith(".json"))
  .map(
    (file) => [file, JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture] as const,
  );

describe("LinkedIn contract: extracted-DOM fixture replay (A1 §1.7)", () => {
  it("finds the Playwright fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const [file, fixture] of fixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      if (fixture.expected.errorKind) {
        expect(mapError(fixture.raw).kind).toBe(fixture.expected.errorKind);
      } else {
        expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
      }
    });
  }

  it("covers the A1 §1.7 minimum scenarios plus the LinkedIn selector case", () => {
    const scenarios = fixtures.map(([, f]) => f.scenario);
    for (const required of [
      "text_message",
      "thread_reply",
      "attachment",
      "rate_limited_response",
      "auth_error_response",
      "selector_missing",
    ]) {
      expect(scenarios).toContain(required);
    }
  });

  // The extractor output is synthetic until spike A1-⑧ samples a real page, and a fixture that does not
  // say so reads as real captured data.
  it("labels every fixture with its provenance", () => {
    for (const [file, fixture] of fixtures) {
      expect(fixture.provenance, file).toBeTruthy();
      expect(fixture.note, file).toBeTruthy();
    }
  });
});

// The replay loop above pins "this raw becomes exactly this item" per fixture; this block is the
// inverse — invariants the kernel relies on, checked against every fixture's expected items (which
// the loop just proved equal to normalize() output).
describe("LinkedIn contract: NormalizedItem invariants", () => {
  const produced = fixtures
    .filter(([, f]) => f.expected.items !== undefined)
    .flatMap(([file, f]) =>
      (f.expected.items ?? []).map((item, index) => ({
        file,
        index,
        item: item as NormalizedItem,
      })),
    );

  it("has items to check", () => {
    expect(produced.length).toBeGreaterThan(0);
  });

  for (const { file, index, item } of produced) {
    it(`${file}#${index} → ${item.externalId ?? "(no externalId)"}`, () => {
      expect(typeof item.externalId).toBe("string");
      expect(item.externalId).not.toBe("");
      expect(typeof item.threadExternalId).toBe("string");
      expect(item.threadExternalId).not.toBe("");

      expect(new Date(item.sentAt).toString()).not.toBe("Invalid Date");
      expect(new Date(item.sentAt).toISOString()).toBe(item.sentAt);

      expect(item.author?.kind).toBe("person");
      expect(item.author?.id).not.toBe("");

      // LinkedIn keys on the DOM ordinal + timestamp (A1 §2.9), so the hash is a plain sha256 and the
      // item id is that hash — never the body.
      expect(item.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(item.externalId).toBe(item.sourceHash);

      const attachments = item.attachments ?? [];
      expect(item.body.length > 0 || attachments.length > 0).toBe(true);
      for (const attachment of attachments) {
        expect(attachment.kind).toBeTruthy();
      }

      if (item.threadMeta !== undefined) {
        expect(item.threadMeta.externalId).toBe(item.threadExternalId);
        expect(item.threadMeta.kind).toBeTruthy();
      }
    });
  }
});
