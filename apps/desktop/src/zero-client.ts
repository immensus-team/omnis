import { zeroSchema } from "@omnis/kernel/zero";
import { Zero } from "@rocicorp/zero";

// OMNIS_HUB_HTTP_URL: 인터페이스 계약 §9 환경변수 목록(계약 리뷰 M11) — api/approvals.ts와 같은 기본값.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

let cachedToken: string | undefined;

/**
 * US-A21b: zeroSchema의 permissions는 토큰의 `sub`가 설정된 유저일 때만 row를 내려준다.
 * 토큰 없이 붙으면 쿼리는 resolve되지만 행은 0개다 — US-A22가 본 증상이 정확히 이것이다.
 */
export async function fetchZeroToken(hubUrl: string = HUB_HTTP_URL): Promise<string> {
  const res = await fetch(`${hubUrl}/api/zero-token`);
  if (!res.ok) throw new Error(`zero token fetch failed: HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/**
 * 부팅 때 한 번(main.tsx) 호출해 토큰을 받아 둔다. `initZero`는 계약 §7대로 동기 함수이고
 * (Inbox/Thread/AgentSession이 useMemo로 그렇게 쓴다) Zero의 나중-인증 경로
 * `connection.connect({auth})`는 이미 하이드레이션된 쿼리를 다시 태우지 않아 첫 화면이 빈 채로
 * 남는다(2026-09-20 확인). 그래서 토큰은 생성자에 실어야 한다.
 */
export async function loadZeroToken(hubUrl?: string): Promise<void> {
  cachedToken = await fetchZeroToken(hubUrl);
}

/** zero-cache는 JWT의 sub와 클라이언트 userID가 다르면 토큰을 거부한다(JWTClaimValidationFailed). */
function jwtSub(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (payload === undefined) return undefined;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { sub?: string }).sub;
  } catch {
    return undefined;
  }
}

export function initZero(opts?: { server?: string; userID?: string; auth?: string }) {
  const auth = opts?.auth ?? cachedToken;
  return new Zero({
    server: opts?.server ?? import.meta.env.OMNIS_ZERO_URL ?? "http://127.0.0.1:4848",
    // 토큰이 있으면 sub를 따라간다 — OMNIS_USER_ID를 바꿔도 양쪽이 저절로 맞는다.
    userID: opts?.userID ?? (auth === undefined ? undefined : jwtSub(auth)) ?? "logan",
    schema: zeroSchema,
    auth,
  });
}
