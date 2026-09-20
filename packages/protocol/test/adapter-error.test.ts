import { describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter.js";

describe("AdapterError", () => {
  it("carries kind, channel, retryAfterMs and cause; name matches class", () => {
    const cause = new Error("boom");
    const err = new AdapterError("retryable_rate_limit", "slack", "rate limited", 30_000, cause);
    expect(err.name).toBe("AdapterError");
    expect(err.kind).toBe("retryable_rate_limit");
    expect(err.channel).toBe("slack");
    expect(err.retryAfterMs).toBe(30_000);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });
});
