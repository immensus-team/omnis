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

describe("Telegram contract: fixture replay", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
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
