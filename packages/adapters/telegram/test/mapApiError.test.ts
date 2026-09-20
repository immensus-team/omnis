import { describe, expect, it } from "vitest";
import { mapApiError } from "../src/index.js";

describe("Telegram mapApiError()", () => {
  it("parses FLOOD_WAIT_<seconds> into retryable_rate_limit", () => {
    const err = mapApiError({ code: 420, message: "FLOOD_WAIT_45" });
    expect(err.kind).toBe("retryable_rate_limit");
    expect(err.retryAfterMs).toBe(45_000);
  });
  it("maps AUTH_KEY_UNREGISTERED to auth_revoked", () => {
    expect(mapApiError({ code: 401, message: "AUTH_KEY_UNREGISTERED" }).kind).toBe("auth_revoked");
  });
  it("falls back to retryable_network otherwise", () => {
    expect(mapApiError({ code: 500, message: "INTERNAL" }).kind).toBe("retryable_network");
  });
});
