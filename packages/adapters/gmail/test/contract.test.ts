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

// 케이스별 기대값(위 블록)과 별개로, 어떤 payload에서 나왔든 item이 갖춰야 할 성질을 본다.
// payload가 늘어날 때 "정규화는 됐지만 쓸 수 없는 item"이 조용히 섞여 들어오는 걸 막는 그물.
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
