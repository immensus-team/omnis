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

// 위 replay 루프는 "이 raw가 정확히 이 아이템이 된다"를 픽스처마다 고정한다. 아래는 반대로,
// 픽스처가 늘어나도 계속 성립해야 하는 아이템 자체의 불변식이다 — 이 shape을 커널이 소비하므로
// 어느 픽스처에서 나온 아이템이든 지켜야 한다. replay 루프가 expected === normalize(raw)를 이미
// 못 박았으므로 여기서 expected.items를 검사하는 건 실제 normalize() 출력을 검사하는 것과 같다
// (동시에 픽스처 자체에 잘못된 아이템을 손으로 적어 넣는 것도 막는다).
describe("Telegram contract: NormalizedItem invariants", () => {
  const itemFixtures = fixtures.filter(([, f]) => f.expected.items !== undefined);
  const produced = itemFixtures.flatMap(([file, f]) =>
    (f.expected.items ?? []).map((item, index) => ({
      file,
      index,
      item: item as NormalizedItem,
    })),
  );

  // 필터가 잘못돼 검사 대상이 0개가 되면 아래 루프가 조용히 통과해 버린다 — 그 구멍을 막는다.
  it("has items to check", () => {
    expect(produced.length).toBeGreaterThan(0);
  });

  for (const { file, index, item } of produced) {
    it(`${file}#${index} → ${item.externalId ?? "(externalId 없음)"}`, () => {
      expect(typeof item.externalId).toBe("string");
      expect(item.externalId).not.toBe("");
      expect(typeof item.threadExternalId).toBe("string");
      expect(item.threadExternalId).not.toBe("");

      // ISO-8601로 읽히고, 다른 어댑터와 같은 `.SSSZ` 왕복 포맷을 유지하는지까지 본다.
      expect(new Date(item.sentAt).toString()).not.toBe("Invalid Date");
      expect(new Date(item.sentAt).toISOString()).toBe(item.sentAt);

      expect(item.author).toBeDefined();
      expect(typeof item.author?.kind).toBe("string");
      expect(item.author?.kind).not.toBe("");

      // 본문이 비어 있으면 첨부가 그 아이템의 내용이어야 한다 — 둘 다 비면 커널에 아무것도
      // 전달하지 못하는 아이템이다(normalize()가 그런 raw를 버리는 이유와 같다).
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
