import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendarAdapter } from "../src/index.js";

describe("Google Calendar adapter backfill()", () => {
  it("lists events across the quarter-start..+90d window and normalizes each", async () => {
    const list = vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: "evt1",
            status: "confirmed",
            summary: "omnis launch sync",
            start: { dateTime: "2026-09-25T01:00:00Z" },
            end: { dateTime: "2026-09-25T01:30:00Z" },
          },
        ],
      },
    });
    const calendarClient = { events: { list } } as never;
    const adapter = createGoogleCalendarAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      calendarClient,
    });

    const collected = [];
    for await (const item of adapter.backfill()) collected.push(item);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.externalId).toBe("evt1");
  });
});

describe("Google Calendar adapter send()", () => {
  it("calls only the injected sink, never events.insert", async () => {
    const sink = vi
      .fn()
      .mockResolvedValue({ externalId: "evt-new", sentAt: "2026-09-25T09:00:00.000Z" });
    const calendarClient = { events: { insert: vi.fn() } } as never;
    const adapter = createGoogleCalendarAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      calendarClient,
      sink,
    });

    const result = await adapter.send(
      { accountId: "acc-1", externalId: "primary" },
      { text: "propose 2pm sync" },
    );
    expect(sink).toHaveBeenCalledTimes(1);
    expect(result.externalId).toBe("evt-new");
    expect(
      (calendarClient as { events: { insert: ReturnType<typeof vi.fn> } }).events.insert,
    ).not.toHaveBeenCalled();
  });
});
