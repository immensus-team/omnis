import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapApiError, normalize } from "../src/index.js";

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

/** Fixtures that pin normalize() output (as opposed to mapApiError() error kinds). */
const itemFixtures = fixtures.filter(({ fixture }) => Array.isArray(fixture.expected.items));

const isNonEmptyString = (v: unknown): boolean => typeof v === "string" && v.length > 0;
const isParsableDate = (v: unknown): boolean =>
  isNonEmptyString(v) && new Date(v as string).toString() !== "Invalid Date";

describe("Slack contract: fixture replay", () => {
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

describe("Slack contract: invariants on every normalized item", () => {
  for (const { file, fixture } of itemFixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      const items = normalize(fixture.raw);

      // Each assertion collects the offending externalIds, so a failure names the item.
      const bad = (predicate: (item: (typeof items)[number]) => boolean) =>
        items.filter(predicate).map((item) => item.externalId);

      expect(bad((item) => !isNonEmptyString(item.externalId))).toEqual([]);
      expect(bad((item) => !isNonEmptyString(item.threadExternalId))).toEqual([]);
      expect(bad((item) => !isParsableDate(item.sentAt))).toEqual([]);
      expect(bad((item) => !item.author || !isNonEmptyString(item.author.kind))).toEqual([]);
      expect(
        bad((item) => !(isNonEmptyString(item.body) || (item.attachments?.length ?? 0) > 0)),
      ).toEqual([]);
      expect(
        bad(
          (item) => item.threadMeta !== undefined && !isNonEmptyString(item.threadMeta.externalId),
        ),
      ).toEqual([]);
    });
  }
});
