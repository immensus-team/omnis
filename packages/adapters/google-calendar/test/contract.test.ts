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

describe("Google Calendar contract: fixture replay", () => {
  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
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
