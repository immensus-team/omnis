// @vitest-environment jsdom
// The root `pnpm test` does not read apps/web/vitest.config.ts — see app.test.tsx.
import "./setup";

import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToPush, toSubscriptionPayload } from "../src/push/subscribe.js";

describe("toSubscriptionPayload (PushSubscriptionJSON → hub PushSubscription body)", () => {
  it("maps p256dh/auth keys and drops a missing ua", () => {
    const json = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    } as PushSubscriptionJSON;
    expect(toSubscriptionPayload(json)).toEqual({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("throws when the browser omits keys (should not happen, but don't silently send garbage)", () => {
    const json = { endpoint: "https://push.example/abc" } as PushSubscriptionJSON;
    expect(() => toSubscriptionPayload(json)).toThrow();
  });

  it("throws when the endpoint is missing too", () => {
    expect(() => toSubscriptionPayload({ keys: { p256dh: "p", auth: "a" } } as never)).toThrow();
  });

  // The ua is why the column exists: with two devices subscribed, "which one is dead?" is the only
  // question the sender ever has to answer. delta §2.3 caps it at 200 chars.
  it("carries a truncated ua when the caller has one", () => {
    const json = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
    } as PushSubscriptionJSON;
    expect(toSubscriptionPayload(json, "iPhone Safari").ua).toBe("iPhone Safari");
    expect(toSubscriptionPayload(json, "x".repeat(500)).ua).toHaveLength(200);
  });
});

describe("subscribeToPush (A5 §4.5 — when to ask is the caller's decision, not this module's)", () => {
  const endpoint = "https://push.example/abc";
  const json = { endpoint, keys: { p256dh: "p", auth: "a" } };

  function fakeBrowser(keyStatus = 200) {
    const subscribe = vi.fn().mockResolvedValue({ toJSON: () => json });
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve({ pushManager: { subscribe } }) },
      configurable: true,
    });
    Object.defineProperty(navigator, "userAgent", { value: "Test Agent", configurable: true });
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/push/vapid-public-key")
          ? { ok: keyStatus === 200, status: keyStatus, json: async () => ({ key: "pub" }) }
          : { ok: true, status: 200, json: async () => ({ id: "sub-1" }) },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return { subscribe, fetchMock };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the key, subscribes user-visible-only, and posts the payload it got back", async () => {
    const { subscribe, fetchMock } = fakeBrowser();
    await subscribeToPush();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8787/push/vapid-public-key");
    // userVisibleOnly is not decoration: Safari refuses the subscription without it.
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: "pub" });

    const [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }];
    expect(url).toBe("http://127.0.0.1:8787/push/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      ua: "Test Agent",
    });
  });

  it("stops before subscribing when the hub has no key to hand out (503)", async () => {
    const { subscribe, fetchMock } = fakeBrowser(503);
    await expect(subscribeToPush()).rejects.toThrow(/503/);
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
