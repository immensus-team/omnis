// @vitest-environment jsdom
// The root `pnpm test` does not read apps/web/vitest.config.ts — see app.test.tsx.
import "./setup";

import { describe, expect, it } from "vitest";
import { buildNotificationOptions, resolveNotificationClick } from "../src/push/sw-push.js";

describe("buildNotificationOptions (A5 §4.4: at most 2 actions Approve/Open, body 80 chars)", () => {
  it("includes an Approve action only when approval_id is present", () => {
    const withApproval = buildNotificationOptions({
      kind: "draft",
      title: "New draft",
      body: "Please confirm",
      deep_link: "omnis://thread/t1",
      approval_id: "ap1",
    });
    expect(withApproval.actions).toEqual([
      { action: "approve", title: "Approve" },
      { action: "open", title: "Open" },
    ]);
    const withoutApproval = buildNotificationOptions({
      kind: "digest",
      title: "Nightly digest ready · 42 archived",
      body: "",
      deep_link: "omnis://digest",
    });
    expect(withoutApproval.actions).toEqual([{ action: "open", title: "Open" }]);
  });

  // A5 §4.4's 80-char rule is the sender's job (the hub runs first80 before it encrypts the
  // payload), and a notification body is not a place to re-wrap text the server already decided.
  it("passes the body through untouched", () => {
    const long = "x".repeat(80);
    expect(
      buildNotificationOptions({ kind: "vip", title: "t", body: long, deep_link: "omnis://x" })
        .body,
    ).toBe(long);
  });
});

describe("resolveNotificationClick (Approve = pending_approvals accept, Open = deep link)", () => {
  const payload = {
    kind: "draft" as const,
    title: "t",
    body: "b",
    deep_link: "omnis://thread/t1",
    approval_id: "ap1",
  };

  it("approve action resolves to an approve intent with the approval id", () => {
    expect(resolveNotificationClick("approve", payload)).toEqual({
      kind: "approve",
      approvalId: "ap1",
    });
  });

  it("open action (or the bare notification body) resolves to opening the deep link", () => {
    expect(resolveNotificationClick("open", payload)).toEqual({
      kind: "open",
      url: "omnis://thread/t1",
    });
    expect(resolveNotificationClick("", payload)).toEqual({
      kind: "open",
      url: "omnis://thread/t1",
    });
  });

  // An Approve tap on a payload that carries no approval id must still open something: the
  // notification is already on screen, and dropping the tap would look like the app being broken.
  it("falls back to the deep link when approve arrives without an approval id", () => {
    const { approval_id: _dropped, ...noId } = payload;
    expect(resolveNotificationClick("approve", noId)).toEqual({
      kind: "open",
      url: "omnis://thread/t1",
    });
  });
});
