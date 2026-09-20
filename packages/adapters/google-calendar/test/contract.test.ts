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

// 이 어댑터가 커널로 내보내는 모든 아이템에 대해 채널과 무관하게 성립해야 하는 최소 계약.
// 픽스처의 expected.items는 normalize() 실제 출력이므로, 여기서 깨지면 normalize()가 계약을 위반한 것이다.
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
      for (const raw of fixture.expected.items ?? []) {
        const item = raw as NormalizedItemShape;

        // 스레드/아이템 식별자: 커널이 스레드를 묶고 중복을 제거하는 키다 — 비어 있으면 안 된다.
        expect(item.externalId, `${fixture.scenario}: externalId`).toBeTypeOf("string");
        expect(item.externalId, `${fixture.scenario}: externalId`).not.toBe("");
        expect(item.threadExternalId, `${fixture.scenario}: threadExternalId`).toBeTypeOf("string");
        expect(item.threadExternalId, `${fixture.scenario}: threadExternalId`).not.toBe("");

        // sentAt: 정렬·증분 수집의 기준 시각. 파싱 불가능한 문자열이면 안 된다.
        const sentAt = item.sentAt as string;
        expect(new Date(sentAt).toString(), `${fixture.scenario}: sentAt`).not.toBe("Invalid Date");

        // ISO 8601 왕복. outlook은 sentAt을 `.SSSZ`로 정규화해 내보내므로
        // `new Date(sentAt).toISOString() === sentAt` 항등식이 성립하지만(outlook 테스트 참고), 이
        // 어댑터는 API가 준 dateTime 문자열을 오프셋(`+09:00`)·플로팅 시각까지 그대로 보존한다 —
        // 같은 instant를 다른 표기로 담으므로 항등식은 성립하지 않는다. 여기서 실제로 보장하는 건
        // "ISO-8601 datetime 표기이고, 어떤 폴백을 타더라도 instant가 유실되지 않는다"이므로 그것을
        // 고정한다(예: 폴백이 description 텍스트나 빈 문자열을 sentAt에 흘리면 여기서 걸린다).
        // toISOString()은 Invalid Date에서 RangeError를 던지므로 파싱 실패도 여기서 함께 잡힌다.
        expect(sentAt, `${fixture.scenario}: sentAt`).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
        );
        expect(
          new Date(new Date(sentAt).toISOString()).getTime(),
          `${fixture.scenario}: sentAt ISO roundtrip`,
        ).toBe(new Date(sentAt).getTime());

        // author: 항상 존재하고 kind가 채워져야 한다(이 어댑터는 system 고정).
        expect(item.author, `${fixture.scenario}: author`).toBeDefined();
        expect(item.author?.kind, `${fixture.scenario}: author.kind`).toBeTypeOf("string");
        expect(item.author?.kind, `${fixture.scenario}: author.kind`).not.toBe("");

        // 표현할 내용이 0인 아이템은 내보내지 않는다: body가 있거나 첨부가 있어야 한다.
        const body = typeof item.body === "string" ? item.body : "";
        const attachments = Array.isArray(item.attachments) ? item.attachments : [];
        expect(
          body.length > 0 || attachments.length > 0,
          `${fixture.scenario}: contentless item ${String(item.externalId)}`,
        ).toBe(true);

        // threadMeta가 실리면 externalId는 필수다(없으면 스레드 병합이 깨진다).
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
    const total = itemsFixtures.reduce(
      (n, { fixture }) => n + (fixture.expected.items?.length ?? 0),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
