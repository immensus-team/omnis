import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendarAdapter } from "../src/index.js";

describe("Google Calendar adapter subscribe()", () => {
  it("polls events.list with syncToken and yields normalized events", async () => {
    const list = vi.fn().mockResolvedValueOnce({
      data: {
        nextSyncToken: "sync-token-1",
        items: [
          {
            id: "evt1",
            status: "confirmed",
            summary: "omnis launch sync",
            start: { dateTime: "2026-09-25T10:00:00+09:00" },
            end: { dateTime: "2026-09-25T10:30:00+09:00" },
          },
        ],
      },
    });
    const calendarClient = { events: { list } } as never;
    let ticks = 0;
    const adapter = createGoogleCalendarAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      calendarClient,
      pollIntervalMs: 0,
    });

    const iterator = adapter.subscribe()[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    if (first.value && "kind" in first.value === false) {
      expect(first.value.externalId).toBe("evt1");
    }
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "primary" }));
    ticks += 1;
    expect(ticks).toBe(1);
  });
});
