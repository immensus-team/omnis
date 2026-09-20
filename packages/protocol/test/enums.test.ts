import { describe, expect, it } from "vitest";
import { Channel, SessionKey, ThreadKind } from "../src/adapter.js";

describe("protocol value sets", () => {
  it("Channel accepts the 10 contract values and rejects unknown channels", () => {
    expect(Channel.parse("slack")).toBe("slack");
    expect(Channel.parse("gcal")).toBe("gcal");
    expect(Channel.parse("agent")).toBe("agent");
    expect(Channel.parse("system")).toBe("system");
    expect(() => Channel.parse("discord")).toThrow();
  });

  it("ThreadKind accepts calendar and agent_session", () => {
    expect(ThreadKind.parse("calendar")).toBe("calendar");
    expect(ThreadKind.parse("agent_session")).toBe("agent_session");
  });

  it("SessionKey enforces agent:<runtime>:<mini|macbook>:<purpose>", () => {
    expect(SessionKey.parse("agent:codex:mini:inbox-classify")).toBe(
      "agent:codex:mini:inbox-classify",
    );
    expect(() => SessionKey.parse("agent:codex:phone:inbox-classify")).toThrow();
    expect(() => SessionKey.parse("not-a-session-key")).toThrow();
  });
});
