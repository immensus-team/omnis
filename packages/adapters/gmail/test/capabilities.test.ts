import { describe, expect, it } from "vitest";
import { createGmailAdapter } from "../src/index.js";

describe("Gmail adapter capabilities", () => {
  it("declares full write-back per A1 §3 (send/markRead/archive all true)", () => {
    const adapter = createGmailAdapter({
      oauthClientId: "test-client-id",
      oauthClientSecret: "test-client-secret",
    });
    expect(adapter.channel).toBe("gmail");
    expect(adapter.capabilities()).toEqual({
      read: true,
      write: true,
      realtime: true,
      history: true,
      media: true,
      markRead: true,
      typing: false,
      archive: true,
      delete: false,
    });
  });
});
