import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger.js";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
  setVapidDetails: vi.fn(),
  sendNotification,
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

const logger = createLogger("test");
const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:x@example.com" };
const payload = {
  kind: "approval" as const,
  title: "omnis",
  body: "승인 대기 1건",
  deep_link: "omnis://thread/abc",
  approval_id: "11111111-1111-1111-1111-111111111111",
};

beforeEach(async () => {
  sendNotification.mockReset();
  await pool.query("DELETE FROM push_subscriptions");
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua)
     VALUES ('https://push.example/a','p','a','iPhone'),
            ('https://push.example/b','p','a','iPhone')`,
  );
});

describe("sendWebPush (A5 §4.4)", () => {
  it("sends one notification per subscription with the Approve action", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush({ pool, vapid, logger }, payload);
    expect(sent).toBe(2);
    const body = JSON.parse(String(sendNotification.mock.calls[0]?.[1]));
    expect(body.actions.map((a: { action: string }) => a.action)).toEqual(["approve", "open"]);
    expect(body.data.approval_id).toBe(payload.approval_id);
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM push_subscriptions WHERE last_ok_at IS NOT NULL",
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("prunes a subscription on 410 and keeps the others", async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockResolvedValueOnce({ statusCode: 201 });
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush({ pool, vapid, logger }, payload);
    expect(sent).toBe(1);
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM push_subscriptions",
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("keeps a subscription on a transient failure and counts it", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush({ pool, vapid, logger }, payload);
    expect(sent).toBe(0);
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM push_subscriptions WHERE fail_count = 1",
    );
    expect(rows[0]?.n).toBe("2");
  });

  it("returns 0 and sends nothing when VAPID keys are missing", async () => {
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush(
      { pool, vapid: { publicKey: "", privateKey: "", subject: "" }, logger },
      payload,
    );
    expect(sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("vapidFromEnv (델타 §9)", () => {
  it("reads the three env vars and defaults the subject", async () => {
    const { vapidFromEnv } = await import("../../src/notify/webpush.js");
    expect(
      vapidFromEnv({ OMNIS_WEBPUSH_VAPID_PUBLIC: "P", OMNIS_WEBPUSH_VAPID_PRIVATE: "S" }),
    ).toEqual({
      publicKey: "P",
      privateKey: "S",
      subject: "mailto:281932556+jinhologankim@users.noreply.github.com",
    });
    expect(vapidFromEnv({}).publicKey).toBe("");
  });
});
