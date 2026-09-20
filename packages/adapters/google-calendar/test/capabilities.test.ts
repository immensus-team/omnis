import { describe, expect, it } from "vitest";
import { CHANNEL, createGoogleCalendarAdapter } from "../src/index.js";

describe("Google Calendar adapter", () => {
  it("uses channel value 'gcal' even though the package dir is google-calendar", () => {
    expect(CHANNEL).toBe("gcal");
  });

  it("declares write as approval-gated only (A1 §3: R/W(hold))", () => {
    const adapter = createGoogleCalendarAdapter({
      oauthClientId: "id",
      oauthClientSecret: "secret",
    });
    expect(adapter.channel).toBe("gcal");
    expect(adapter.capabilities()).toEqual({
      read: true,
      write: true,
      realtime: false,
      history: true,
      media: false,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    });
  });
});
