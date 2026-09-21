// US-C13 (Q3, A5 §3.9): the KakaoTalk send gate's decision table. Two keys open it — a stable read
// for KAKAO_STABLE_DAYS (`kakao.read_stable_since`) and Logan's explicit opt-in
// (`kakao.send_enabled_at`) — and either one alone leaves send closed.
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  KAKAO_STABLE_DAYS,
  type KakaoSendState,
  kakaoSendState,
  kakaoSendStep,
} from "../src/kakao-send.js";

const NOW = new Date("2026-09-22T09:00:00.000Z");
const DAY_MS = 86_400_000;
const DRY_ID = "11111111-1111-4111-8111-111111111111";

/** An ISO instant `days` before NOW — the shape `setSetting(pool, key, new Date().toISOString())`
 *  stores a stamp in. */
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY_MS).toISOString();

/** `kakaoSendState` reads exactly those two keys, so a stub pool is the whole input. That the two
 *  names are the real settings keys, and that a stamp survives the round trip through jsonb, is
 *  what apps/hub/test/integration/kakao-dry-run.test.ts covers against a live DB. */
function settingsPool(values: { stableSince?: unknown; sendEnabledAt?: unknown }): Pool {
  const byKey: Record<string, unknown> = {
    "kakao.read_stable_since": values.stableSince ?? null,
    "kakao.send_enabled_at": values.sendEnabledAt ?? null,
  };
  return {
    query: (_sql: string, params: readonly unknown[]) =>
      Promise.resolve({ rows: [{ value: byKey[String(params[0])] ?? null }] }),
  } as unknown as Pool;
}

const state = (stableSince: unknown, sendEnabledAt: unknown): Promise<KakaoSendState> =>
  kakaoSendState(settingsPool({ stableSince, sendEnabledAt }), NOW);

describe("kakaoSendState (US-C13)", () => {
  it("counts 14 stable read days", () => {
    expect(KAKAO_STABLE_DAYS).toBe(14);
  });

  it.each([
    {
      name: "no stable read has ever been observed",
      stable: null,
      optIn: null,
      reason: "no_stable_read",
      days: null,
      enabled: false,
    },
    {
      name: "ten days in",
      stable: ago(10),
      optIn: null,
      reason: "counting",
      days: 4,
      enabled: false,
    },
    {
      name: "13.5 days in — the last day still counts",
      stable: ago(13.5),
      optIn: null,
      reason: "counting",
      days: 1,
      enabled: false,
    },
    {
      name: "the count is done but the opt-in is missing",
      stable: ago(14),
      optIn: null,
      reason: "awaiting_opt_in",
      days: 0,
      enabled: false,
    },
    {
      name: "an opt-in that arrived before the 14 days did not shorten them",
      stable: ago(10),
      optIn: ago(9),
      reason: "counting",
      days: 4,
      enabled: false,
    },
    {
      name: "both keys lined up",
      stable: ago(14),
      optIn: ago(0.001),
      reason: "open",
      days: 0,
      enabled: true,
    },
    {
      name: "both keys lined up long ago",
      stable: ago(40),
      optIn: ago(20),
      reason: "open",
      days: 0,
      enabled: true,
    },
  ])("$name → $reason", async ({ stable, optIn, reason, days, enabled }) => {
    expect(await state(stable, optIn)).toEqual({ enabled, daysRemaining: days, reason });
  });

  it("reads an unparseable stamp as no stable read — the closed direction", async () => {
    expect(await state("sometime last week", ago(1))).toEqual({
      enabled: false,
      daysRemaining: null,
      reason: "no_stable_read",
    });
  });
});

describe("kakaoSendStep (US-C13)", () => {
  const open: KakaoSendState = { enabled: true, daysRemaining: 0, reason: "open" };

  it("asks for a dry run first", () => {
    expect(kakaoSendStep(open, { text: "on my way" })).toEqual({ kind: "dry_run" });
  });

  it("executes for real when the approval names the dry run it confirms", () => {
    expect(kakaoSendStep(open, { text: "on my way", confirm_of: DRY_ID })).toEqual({
      kind: "confirm",
      confirmOf: DRY_ID,
    });
  });

  it("treats a confirm_of that is not an id as no confirm at all — the dry run is not optional", () => {
    expect(kakaoSendStep(open, { confirm_of: "" })).toEqual({ kind: "dry_run" });
    expect(kakaoSendStep(open, { confirm_of: 7 })).toEqual({ kind: "dry_run" });
    expect(kakaoSendStep(open, { confirm_of: null })).toEqual({ kind: "dry_run" });
  });

  it("is closed whenever the gate is not open, whatever the args claim", () => {
    const reasons = ["no_stable_read", "counting", "awaiting_opt_in"] as const;
    for (const reason of reasons) {
      expect(
        kakaoSendStep({ enabled: false, daysRemaining: null, reason }, { confirm_of: DRY_ID }),
      ).toEqual({
        kind: "closed",
        reason,
      });
    }
  });
});
