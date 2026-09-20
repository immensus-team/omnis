import { describe, expect, it } from "vitest";
import { createSlackAdapter } from "../src/index.js";

describe("Slack adapter capabilities", () => {
  it("declares archive=false, delete=false, typing=false per A1 §2.1/§3", () => {
    const adapter = createSlackAdapter();
    expect(adapter.channel).toBe("slack");
    expect(adapter.capabilities()).toEqual({
      read: true,
      write: true,
      realtime: true,
      history: true,
      media: true,
      markRead: true,
      typing: false,
      archive: false,
      delete: false,
    });
  });
});
