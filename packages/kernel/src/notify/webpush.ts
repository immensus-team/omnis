// A5 §4.4 + A4 §3.6. 키는 Keychain omnis.webpush.vapid_* → launchd가 env로 주입한다(델타 §9).
// Web Push 단일 오너: VAPID 설정·발송·구독 정리는 이 파일만 갖는다(교차 리뷰 M-webpush).
import { query } from "@omnis/db";
import type { PushPayload } from "@omnis/protocol";
import type { Pool } from "pg";
import webpush from "web-push";
import type { Logger } from "../logger.js";
import { first80 } from "./batch.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** 구독이 사라졌음을 뜻하는 응답. 둘 다 조용히 지운다(RFC 8030). */
export const WEBPUSH_GONE_CODES: readonly number[] = [404, 410];

export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidKeys {
  return {
    publicKey: env.OMNIS_WEBPUSH_VAPID_PUBLIC ?? "",
    privateKey: env.OMNIS_WEBPUSH_VAPID_PRIVATE ?? "",
    subject: env.OMNIS_WEBPUSH_SUBJECT ?? "mailto:281932556+jinhologankim@users.noreply.github.com",
  };
}

export async function pruneSubscription(pool: Pool, endpoint: string): Promise<void> {
  await query(pool, "DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

export async function sendWebPush(
  deps: { pool: Pool; vapid: VapidKeys; logger: Logger },
  payload: PushPayload,
): Promise<number> {
  const { pool, vapid, logger } = deps;
  if (vapid.publicKey === "" || vapid.privateKey === "") {
    logger.warn("web push skipped: VAPID keys are not set");
    return 0;
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    pool,
    "SELECT endpoint, p256dh, auth FROM push_subscriptions",
  );
  // 액션 2개는 A5 §4.4 그대로. approve는 앱을 열지 않고 POST /approvals/:id/decide를 친다.
  const body = JSON.stringify({
    title: payload.title,
    body: first80(payload.body),
    actions: [
      { action: "approve", title: "승인" },
      { action: "open", title: "열기" },
    ],
    data: {
      deep_link: payload.deep_link,
      kind: payload.kind,
      ...(payload.approval_id !== undefined ? { approval_id: payload.approval_id } : {}),
    },
  });

  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent += 1;
      await query(
        pool,
        "UPDATE push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE endpoint = $1",
        [s.endpoint],
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code !== undefined && WEBPUSH_GONE_CODES.includes(code)) {
        await pruneSubscription(pool, s.endpoint);
        continue;
      }
      await query(
        pool,
        "UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = $1",
        [s.endpoint],
      );
      // 키·엔드포인트는 로그에 넣지 않는다(A6-D9).
      logger.error("web push failed", { code: code ?? null });
    }
  }
  return sent;
}
