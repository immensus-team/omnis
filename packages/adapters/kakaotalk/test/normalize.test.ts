import { describe, expect, it } from "vitest";
import { CHANNEL, mapError, nextPollDelayMs, normalize, sourceHash } from "../src/index.js";

const base = {
  chat_id: "1001",
  chat_name: "omnis launch",
  sender: "Dana Lee",
  is_me: false,
  text: "sync tomorrow at 10am",
  timestamp: "2026-09-22T09:14:03+09:00",
};

describe("KakaoTalk sourceHash()", () => {
  it("is stable across calls", () => {
    const a = sourceHash("1001", "2026-09-22T09:14:03+09:00", "Dana Lee", "hi");
    const b = sourceHash("1001", "2026-09-22T09:14:03+09:00", "Dana Lee", "hi");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any of the four inputs changes", () => {
    const baseHash = sourceHash("1001", "2026-09-22T09:14:03+09:00", "Dana Lee", "hi");
    const variants = [
      sourceHash("1002", "2026-09-22T09:14:03+09:00", "Dana Lee", "hi"),
      sourceHash("1001", "2026-09-22T09:14:04+09:00", "Dana Lee", "hi"),
      sourceHash("1001", "2026-09-22T09:14:03+09:00", "Logan Kim", "hi"),
      sourceHash("1001", "2026-09-22T09:14:03+09:00", "Dana Lee", "ho"),
    ];
    expect(new Set([baseHash, ...variants]).size).toBe(5);
  });

  // A1 §2.8: the body contributes only its first 64 characters — two long messages that agree up to
  // that point are the same key, which is the documented surrogate-key behaviour (Kakao exposes no
  // message id).
  it("only reads the first 64 characters of the body", () => {
    const head = "x".repeat(64);
    expect(sourceHash("1001", "t", "s", `${head}aaa`)).toBe(
      sourceHash("1001", "t", "s", `${head}bbb`),
    );
    expect(sourceHash("1001", "t", "s", `${head}aaa`)).not.toBe(
      sourceHash("1001", "t", "s", `${head.slice(0, 63)}yaaa`),
    );
  });
});

describe("KakaoTalk normalize()", () => {
  it("maps a plain line", () => {
    const [item] = normalize({ ...base });
    expect(item?.threadExternalId).toBe("1001");
    expect(item?.author).toEqual({ kind: "person", id: "Dana Lee" });
    expect(item?.body).toBe("sync tomorrow at 10am");
    expect(item?.sentAt).toBe("2026-09-22T00:14:03.000Z");
    expect(item?.kind).toBe("message");
  });

  it("maps own messages to the local person", () => {
    const [item] = normalize({ ...base, is_me: true });
    expect(item?.author).toEqual({ kind: "person", id: "me" });
    expect(item?.threadMeta?.participants).toEqual([{ externalId: "me", displayName: "Dana Lee" }]);
  });

  it("puts the room name in threadMeta.title", () => {
    const [item] = normalize({ ...base, chat_name: "renamed room" });
    expect(item?.threadMeta?.title).toBe("renamed room");
  });

  it("treats a named room as a group and an unnamed one as a dm", () => {
    expect(normalize({ ...base })[0]?.threadMeta?.kind).toBe("group");
    const { chat_name, ...unnamed } = base;
    expect(normalize(unnamed)[0]?.threadMeta?.kind).toBe("dm");
  });

  it("carries attachments through and keeps an attachment-only line", () => {
    const [item] = normalize({ ...base, text: "", attachments: [{ kind: "image" }] });
    expect(item?.body).toBe("");
    expect(item?.attachments).toEqual([{ kind: "image" }]);
  });

  it("falls back to a file attachment for an unknown kind", () => {
    const [item] = normalize({ ...base, attachments: [{ kind: "sticker" }] });
    expect(item?.attachments).toEqual([{ kind: "file" }]);
  });

  it("drops a line without chat_id or timestamp", () => {
    const { chat_id, ...noChat } = base;
    expect(normalize(noChat)).toEqual([]);
    const { timestamp, ...noTimestamp } = base;
    expect(normalize(noTimestamp)).toEqual([]);
  });

  it("drops a line whose timestamp is unparseable, and any non-object raw", () => {
    expect(normalize({ ...base, timestamp: "not a date" })).toEqual([]);
    expect(normalize(null)).toEqual([]);
    expect(normalize("text")).toEqual([]);
    expect(normalize(undefined)).toEqual([]);
  });

  it("keeps the thread keyed by chat_id, so a renamed room is a new thread", () => {
    const before = normalize({ ...base })[0];
    const after = normalize({ ...base, chat_id: "3003", chat_name: "renamed" })[0];
    expect(before?.threadExternalId).toBe("1001");
    expect(after?.threadExternalId).toBe("3003");
    expect(after?.threadMeta?.title).toBe("renamed");
  });

  it("uses the sourceHash as the item id (Kakao exposes no message id)", () => {
    const [item] = normalize({ ...base });
    expect(item?.externalId).toBe(
      sourceHash("1001", "2026-09-22T09:14:03+09:00", "Dana Lee", "sync tomorrow at 10am"),
    );
    expect(item?.sourceHash).toBe(item?.externalId);
  });
});

describe("KakaoTalk mapError()", () => {
  it("maps AX path breakage to fatal_protocol", () => {
    expect(mapError(new Error("AXError: element not found")).kind).toBe("fatal_protocol");
    expect(mapError("AXError: element not found").kind).toBe("fatal_protocol");
  });

  it("maps a dead helper process to retryable_network", () => {
    expect(mapError(new Error("kmsg is not running")).kind).toBe("retryable_network");
    expect(mapError({ error: "kmsg helper is not running" }).kind).toBe("retryable_network");
  });

  it("maps throttling and logged-out states", () => {
    expect(mapError(new Error("too many requests (429)")).kind).toBe("retryable_rate_limit");
    expect(mapError(new Error("KakaoTalk is not logged in")).kind).toBe("auth_expired");
  });

  it("defaults to retryable_network and names the channel", () => {
    const err = mapError(new Error("something else"));
    expect(err.kind).toBe("retryable_network");
    expect(err.channel).toBe(CHANNEL);
  });

  it("reads a message out of an object or string cause", () => {
    expect(mapError({ error: "AXError: element not found" }).message).toContain(
      "element not found",
    );
  });
});

describe("KakaoTalk nextPollDelayMs()", () => {
  it("stays inside the 5-15s clamp and hits both ends", () => {
    expect(nextPollDelayMs(() => 0)).toBe(5000);
    expect(nextPollDelayMs(() => 1)).toBe(15000);
    expect(nextPollDelayMs(() => 0.5)).toBe(10000);
  });

  it("stays in range for real random values", () => {
    for (let i = 0; i < 200; i += 1) {
      const ms = nextPollDelayMs();
      expect(ms).toBeGreaterThanOrEqual(5000);
      expect(ms).toBeLessThanOrEqual(15000);
    }
  });
});
