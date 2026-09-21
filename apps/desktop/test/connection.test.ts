// @vitest-environment jsdom
// loop-r2-05: the connection mapping, as a table. Every row of the brief's ordered rule list is a
// case here, because the *order* is the logic — a socket that is down while the browser is offline
// has two true statements and only one of them is worth putting on screen.
import { describe, expect, it } from "vitest";
import { type ZeroConnectionName, connectionKind } from "../src/lib/connection.js";

/** Connected, online, holding a token: the state every other case is a deviation from. */
const ok = { online: true, zeroName: "connected" as ZeroConnectionName, hasToken: true };

describe("connectionKind (loop-r2-05 step 2's rules, applied in order)", () => {
  it("is ok when the browser is online, Zero is connected and a token was issued", () => {
    expect(connectionKind(ok)).toBe("ok");
  });

  it("is offline whenever the browser says so, whatever Zero thinks", () => {
    // `offline` comes first: the network is the more specific fact, and Zero's own state is a
    // second-hand report of it that lags.
    for (const zeroName of [
      "connecting",
      "connected",
      "disconnected",
      "needs-auth",
      "error",
      "closed",
    ] as const) {
      expect(connectionKind({ ...ok, online: false, zeroName })).toBe("offline");
    }
  });

  it.each(["disconnected", "error", "closed"] as const)(
    "is unreachable while Zero is %s",
    (zeroName) => {
      expect(connectionKind({ ...ok, zeroName })).toBe("unreachable");
    },
  );

  it("is unreachable with no token, even though Zero reports connected", () => {
    // The case that matters in practice is the boot timeout: main.tsx gives the hub 4s, then builds
    // Zero without auth. Zero's own state is then `connecting` forever — nothing is retrying, so
    // "connecting" would be a lie and "unreachable" is the truth.
    expect(connectionKind({ ...ok, hasToken: false })).toBe("unreachable");
    expect(connectionKind({ ...ok, hasToken: false, zeroName: "connecting" })).toBe("unreachable");
  });

  it("is session when the token is stale, not unreachable", () => {
    expect(connectionKind({ ...ok, zeroName: "needs-auth" })).toBe("session");
  });

  it("is connecting on the way up", () => {
    expect(connectionKind({ ...ok, zeroName: "connecting" })).toBe("connecting");
  });
});
