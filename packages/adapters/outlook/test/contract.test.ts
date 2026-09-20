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

describe("Outlook contract: fixture replay", () => {
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

// Separate from the per-payload expectations above, this checks the properties every item must have
// no matter which payload produced it — a net against "normalized but unusable" items (one that will
// not attach to a thread, has a broken timestamp, or has neither body nor attachments) quietly
// slipping in as fixtures keep growing.
describe("Outlook contract: invariants on every normalized item", () => {
  for (const { file, fixture } of itemFixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      const items = normalize(fixture.raw);

      // Collect the externalIds of the failing items so it is obvious which message broke the contract.
      const bad = (predicate: (item: (typeof items)[number]) => boolean) =>
        items.filter(predicate).map((item) => item.externalId);

      expect(bad((item) => !isNonEmptyString(item.externalId))).toEqual([]);
      expect(bad((item) => !isNonEmptyString(item.threadExternalId))).toEqual([]);
      expect(bad((item) => !isParsableDate(item.sentAt))).toEqual([]);
      // The adapter always round-trips to `.SSSZ` on the way out (parseSentAt in src) — a fallback that breaks that format gets caught here.
      expect(bad((item) => new Date(item.sentAt).toISOString() !== item.sentAt)).toEqual([]);
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
