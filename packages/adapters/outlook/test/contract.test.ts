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

// payload별 기대값(위 블록)과 별개로, 어떤 payload에서 나왔든 item이 갖춰야 할 성질을 본다.
// payload가 늘어날 때 "정규화는 됐지만 쓸 수 없는 item"(스레드에 못 붙거나, 시각이 깨졌거나,
// 본문도 첨부도 없는 item)이 조용히 섞여 들어오는 걸 막는 그물 — fixtures 는 계속 늘어난다.
describe("Outlook contract: invariants on every normalized item", () => {
  for (const { file, fixture } of itemFixtures) {
    it(`${fixture.scenario} (${file})`, () => {
      const items = normalize(fixture.raw);

      // 실패한 item의 externalId를 모아서 보여준다 — 어느 메시지가 계약을 깼는지 바로 보이도록.
      const bad = (predicate: (item: (typeof items)[number]) => boolean) =>
        items.filter(predicate).map((item) => item.externalId);

      expect(bad((item) => !isNonEmptyString(item.externalId))).toEqual([]);
      expect(bad((item) => !isNonEmptyString(item.threadExternalId))).toEqual([]);
      expect(bad((item) => !isParsableDate(item.sentAt))).toEqual([]);
      // 어댑터는 항상 `.SSSZ`로 왕복시켜 내보낸다(src의 parseSentAt) — 폴백이 그 포맷을 깨면 여기서 걸린다.
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
