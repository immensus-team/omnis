import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { type Kernel, SETTING_DEFAULTS, createKernel, createLogger } from "@omnis/kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HUB_VERSION, type HubConfig } from "../../src/config.js";
import { createHubServer } from "../../src/http.js";

/** VAPID present by default so the /push/* family answers; the 503 case below empties it. */
function testConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    version: HUB_VERSION,
    bridgeToken: "",
    userId: "logan",
    zeroAuthSecret: "test-zero-secret",
    googleOAuthClientId: "",
    googleOAuthClientSecret: "",
    outlookClientId: "",
    ntfyUrl: "http://127.0.0.1:2586",
    webpushVapidPublic: "test-public-key",
    webpushVapidPrivate: "test-private-key",
    webpushSubject: "mailto:test@example.com",
    ...overrides,
  };
}

let base = "";
let kernel: Kernel;
let pool: ReturnType<typeof createPool>;
let close: () => Promise<void>;

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool });
  const server = createHubServer({
    kernel,
    pool,
    config: testConfig(),
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await kernel.close();
    await pool.end();
  };
});
beforeEach(async () => {
  await kernel.killSwitch.set(false, "routes reset");
});
afterAll(async () => {
  await close();
});

const propose = (): Promise<string> =>
  kernel.approvals.propose({
    action: "send",
    args: { text: "hi" },
    description: "route test",
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    risk: "normal",
  });

describe("GET /health", () => {
  it("reports version, db up, uptime and the kill switch", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBe(HUB_VERSION);
    expect(body.db).toBe("up");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.killSwitch).toBe(false);
  });
});

describe("GET /approvals", () => {
  it("returns pending approvals under the limit", async () => {
    await propose();
    const res = await fetch(`${base}/approvals?state=pending&limit=5`);
    const body = (await res.json()) as { approvals: Array<{ state: string }> };
    expect(body.approvals.length).toBeGreaterThanOrEqual(1);
    expect(body.approvals.length).toBeLessThanOrEqual(5);
    expect(body.approvals.every((a) => a.state === "pending")).toBe(true);
  });

  it("rejects an unknown state with 400", async () => {
    const res = await fetch(`${base}/approvals?state=banana`);
    expect(res.status).toBe(400);
  });
});

describe("POST /approvals/:id/decide", () => {
  it("decides a pending approval", async () => {
    const id = await propose();
    const res = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, state: "decided" });
  });

  it("maps ApprovalStateError to 409 and a bad body to 400", async () => {
    const id = await propose();
    await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    const second = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "ignore" }),
    });
    expect(second.status).toBe(409);

    const bad = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
  });
});

describe("kill switch routes", () => {
  it("round-trips GET and POST", async () => {
    const on = await fetch(`${base}/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: true, reason: "route test" }),
    });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as { on: boolean; since: string };
    expect(onBody.on).toBe(true);
    expect(onBody.since).toMatch(/^\d{4}-/);

    const get = await fetch(`${base}/kill-switch`);
    const body = (await get.json()) as { on: boolean; reason: string };
    expect(body.on).toBe(true);
    expect(body.reason).toBe("route test");

    const health = (await (await fetch(`${base}/health`)).json()) as { killSwitch: boolean };
    expect(health.killSwitch).toBe(true);
  });

  it("requires a boolean on and a reason", async () => {
    const res = await fetch(`${base}/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("unknown routes", () => {
  it("404s anything no route owns", async () => {
    // /search, /memory/search and /transcript/:id are live now, so the only 404s left are
    // paths nobody claims — including /transcript without a trailing id.
    for (const p of ["/nope", "/transcript"]) {
      expect((await fetch(`${base}${p}`)).status).toBe(404);
    }
  });

  it("405s a wrong method on a known path", async () => {
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
  });
});

describe("GET /api/zero-token (US-A21b)", () => {
  it("signs an HS256 JWT the desktop hands to zero-cache", async () => {
    const res = await fetch(`${base}/api/zero-token`);
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const [h, p, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h as string, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(p as string, "base64url").toString()) as {
      sub: string;
      exp: number;
    };
    expect(claims.sub).toBe("logan");
    // 7 days ±1 minute
    expect(claims.exp * 1000 - Date.now()).toBeGreaterThan(7 * 86_400_000 - 60_000);
    expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(createHmac("sha256", "test-zero-secret").update(`${h}.${p}`).digest("base64url")).toBe(
      sig,
    );
  });

  it("405s a non-GET", async () => {
    expect((await fetch(`${base}/api/zero-token`, { method: "POST" })).status).toBe(405);
  });
});

// US-B26 (A4 §14). The ranking math is unit-tested in src/search.test.ts; this covers the
// HTTP contract and the real SQL fan-out against an empty database.
describe("GET /search", () => {
  it("returns the four groups in the fixed order", async () => {
    const res = await fetch(`${base}/search?q=contract`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      q: string;
      took_ms: number;
      truncated: boolean;
      groups: { kind: string; total: number; results: unknown[] }[];
    };
    expect(body.q).toBe("contract");
    expect(body.groups.map((g) => g.kind)).toEqual(["people", "threads", "items", "memories"]);
    expect(body.truncated).toBe(false);
    expect(typeof body.took_ms).toBe("number");
  });

  it("400s a missing or blank q", async () => {
    expect((await fetch(`${base}/search`)).status).toBe(400);
    expect((await fetch(`${base}/search?q=%20`)).status).toBe(400);
  });

  it("400s a non-positive-integer k", async () => {
    expect((await fetch(`${base}/search?q=x&k=0`)).status).toBe(400);
    expect((await fetch(`${base}/search?q=x&k=abc`)).status).toBe(400);
  });

  it("405s a non-GET", async () => {
    expect((await fetch(`${base}/search?q=x`, { method: "POST" })).status).toBe(405);
  });
});

describe("GET /memory/search", () => {
  it("returns the raw memory hits", async () => {
    const res = await fetch(`${base}/memory/search?q=contract`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { results: unknown[] }).toEqual({ results: [] });
  });

  it("400s a missing q", async () => {
    expect((await fetch(`${base}/memory/search`)).status).toBe(400);
  });
});

// The PUT block below writes cost.cap_usd, so these read-only assertions never pin an exact
// value — this suite shares one DB connection and a fixed cap would be order-dependent.
describe("GET /settings", () => {
  it("returns every setting key, stored value or default", async () => {
    const res = await fetch(`${base}/settings`);
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: Record<string, unknown> };
    expect(Object.keys(settings).sort()).toEqual(Object.keys(SETTING_DEFAULTS).sort());
    expect(typeof settings["cost.cap_usd"]).toBe("number");
  });

  it("405s a non-GET", async () => {
    expect((await fetch(`${base}/settings`, { method: "POST" })).status).toBe(405);
  });
});

describe("PUT /settings/:key", () => {
  it("writes a value that GET /settings reads back", async () => {
    const res = await fetch(`${base}/settings/cost.cap_usd`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 42 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "cost.cap_usd", value: 42 });

    const { settings } = (await (await fetch(`${base}/settings`)).json()) as {
      settings: Record<string, unknown>;
    };
    expect(settings["cost.cap_usd"]).toBe(42);
  });

  it("404s an unknown key before it reads the body", async () => {
    const res = await fetch(`${base}/settings/not.a.real.key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("400s a body without a value property", async () => {
    const res = await fetch(`${base}/settings/cost.cap_usd`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s a body that is not JSON", async () => {
    const res = await fetch(`${base}/settings/cost.cap_usd`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("405s a non-PUT", async () => {
    expect((await fetch(`${base}/settings/cost.cap_usd`)).status).toBe(405);
  });
});

describe("GET /cost", () => {
  it("reports the budget state, month-to-date spend and policy", async () => {
    const res = await fetch(`${base}/cost`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      mtdUsd: unknown;
      capUsd: unknown;
      reserveUsd: unknown;
      policy: { allowT2NonSensitive: boolean };
    };
    expect(["normal", "warn", "degraded", "reserve_only", "frozen"]).toContain(body.state);
    expect(typeof body.mtdUsd).toBe("number");
    expect(typeof body.capUsd).toBe("number");
    expect(typeof body.reserveUsd).toBe("number");
    expect(typeof body.policy.allowT2NonSensitive).toBe("boolean");
  });

  it("405s a non-GET", async () => {
    expect((await fetch(`${base}/cost`, { method: "POST" })).status).toBe(405);
  });
});

describe("PWA Web Push subscription (US-B36, delta §7)", () => {
  const endpoint = "https://push.example/routes-test";
  const create = (body: unknown, method = "POST"): Promise<Response> =>
    fetch(`${base}/push/subscribe`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("GET /push/vapid-public-key hands the browser the key it subscribes with", async () => {
    const res = await fetch(`${base}/push/vapid-public-key`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "test-public-key" });
  });

  it("answers under /api/push/… too, the prefix Tailscale Serve strips", async () => {
    // The PWA reaches the hub through Tailscale (which mounts it at /api) or through the dev
    // proxy — the same reason /threads/:id accepts both spellings.
    expect((await fetch(`${base}/api/push/vapid-public-key`)).status).toBe(200);
  });

  it("stores the subscription, then upserts a re-subscribe onto the same row", async () => {
    const first = await create({ endpoint, keys: { p256dh: "p", auth: "a" }, ua: "route test" });
    expect(first.status).toBe(200);
    const { id } = (await first.json()) as { id: string };
    expect(
      await query<{ p256dh: string; auth: string; ua: string | null }>(
        pool,
        "SELECT p256dh, auth, ua FROM push_subscriptions WHERE endpoint = $1",
        [endpoint],
      ),
    ).toEqual([{ p256dh: "p", auth: "a", ua: "route test" }]);

    // A browser that re-subscribes rotates its keys but keeps the endpoint: that updates in place.
    const second = await create({ endpoint, keys: { p256dh: "p2", auth: "a2" } });
    expect((await second.json()) as { id: string }).toEqual({ id });
    expect(
      await query<{ p256dh: string }>(
        pool,
        "SELECT p256dh FROM push_subscriptions WHERE endpoint = $1",
        [endpoint],
      ),
    ).toEqual([{ p256dh: "p2" }]);
  });

  it("DELETE /push/subscribe removes it, and reports when there was nothing to remove", async () => {
    // Self-contained: this row is created here rather than borrowed from the test above, so either
    // one may be run alone.
    expect((await create({ endpoint, keys: { p256dh: "p", auth: "a" } })).status).toBe(200);
    expect(await (await create({ endpoint }, "DELETE")).json()).toEqual({ removed: true });
    expect(await (await create({ endpoint }, "DELETE")).json()).toEqual({ removed: false });
    expect(
      await query(pool, "SELECT 1 FROM push_subscriptions WHERE endpoint = $1", [endpoint]),
    ).toEqual([]);
  });

  it("400s anything that is not a PushSubscription, and 405s a wrong method", async () => {
    for (const body of [
      { endpoint: "https://push.example/x" }, // no keys at all
      { keys: { p256dh: "p", auth: "a" } }, // no endpoint
      { endpoint: 7, keys: { p256dh: "p", auth: "a" } }, // endpoint is not a string
    ]) {
      expect((await create(body)).status).toBe(400);
    }
    expect((await create({}, "DELETE")).status).toBe(400); // DELETE needs an endpoint too
    expect((await fetch(`${base}/push/vapid-public-key`, { method: "POST" })).status).toBe(405);
  });

  it("503s the whole family when no VAPID keypair is configured (delta §7)", async () => {
    const bare = createHubServer({
      kernel,
      pool,
      config: testConfig({ webpushVapidPublic: "", webpushVapidPrivate: "" }),
      logger: createLogger("@omnis/hub"),
      startedAt: Date.now(),
    });
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    const root = `http://127.0.0.1:${(bare.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${root}/push/vapid-public-key`)).status).toBe(503);
      expect(
        (
          await fetch(`${root}/push/subscribe`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint, keys: { p256dh: "p", auth: "a" } }),
          })
        ).status,
      ).toBe(503);
    } finally {
      await new Promise<void>((r) => bare.close(() => r()));
    }
  });
});
