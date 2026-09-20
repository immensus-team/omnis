import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapApiError, normalize } from "../src/index.js";

interface Fixture {
  scenario: string;
  note?: string;
  raw: unknown;
  expected: { items?: unknown[]; errorKind?: string };
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({
    file,
    fixture: JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture,
  }));

describe("Gmail contract: fixture replay", () => {
  for (const { file, fixture } of fixtures) {
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

// Separate from the per-case expectations above, this checks the properties every item must have
// no matter which payload produced it. A safety net against "normalized but unusable" items quietly
// slipping in as the payload set grows.
describe("Gmail contract: item invariants", () => {
  const itemsFixtures = fixtures.filter(({ fixture }) => fixture.expected.items !== undefined);

  it("covers a non-trivial number of items", () => {
    const total = itemsFixtures.reduce((n, { fixture }) => n + normalize(fixture.raw).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  for (const { file, fixture } of itemsFixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      for (const item of normalize(fixture.raw)) {
        expect(item.externalId.length).toBeGreaterThan(0);
        expect(item.threadExternalId.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(item.sentAt))).toBe(false);
        expect(new Date(item.sentAt).toISOString()).toBe(item.sentAt);
        expect(item.author.kind.length).toBeGreaterThan(0);
        expect(item.body.length > 0 || item.attachments.length > 0).toBe(true);
        if (item.threadMeta) expect(item.threadMeta.externalId.length).toBeGreaterThan(0);
      }
    });
  }
});
