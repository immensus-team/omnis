import { NormalizedItem } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { normalize } from "../src/index.js";

// deviation (plan step 1): the plan's fixture used "+09:00" offset datetimes,
// but @omnis/protocol's NormalizedItem.sentAt is z.string().datetime() with
// no { offset: true } (interfaces.md §3.2, FIXED — out of this task's scope
// to change). z.string().datetime() without offset:true only accepts a "Z"
// suffix and throws on "+09:00". Fixtures below use the equivalent UTC ("Z")
// instants instead so NormalizedItem.parse() actually succeeds as asserted.
describe("Google Calendar normalize()", () => {
  it("maps a confirmed event to a calendar-thread NormalizedItem", () => {
    const raw = {
      id: "evt1",
      status: "confirmed",
      summary: "omnis launch sync",
      start: { dateTime: "2026-09-25T01:00:00Z" },
      end: { dateTime: "2026-09-25T01:30:00Z" },
      attendees: [
        { email: "dana@example.com", displayName: "Dana Lee", responseStatus: "accepted" },
      ],
    };
    const [item] = normalize(raw);
    expect(() => NormalizedItem.parse(item)).not.toThrow();
    expect(item).toMatchObject({
      threadExternalId: "evt1",
      externalId: "evt1",
      kind: "event",
      author: { kind: "system", id: "" },
      body: "omnis launch sync",
      sentAt: "2026-09-25T01:00:00Z",
      status: "received",
      sourceHash: "evt1",
      threadMeta: { kind: "calendar", externalId: "evt1" },
    });
  });

  it("skips cancelled events with no start time", () => {
    expect(normalize({ id: "evt2", status: "cancelled" })).toEqual([]);
  });
});
