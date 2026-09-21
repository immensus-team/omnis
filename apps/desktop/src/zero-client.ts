import { zeroSchema } from "@omnis/kernel/zero";
import { Zero } from "@rocicorp/zero";
import { useZero } from "@rocicorp/zero/react";

// OMNIS_HUB_HTTP_URL: interface contract §9's environment-variable list (contract review M11) — the
// same default as api/approvals.ts.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

let cachedToken: string | undefined;

/**
 * US-A21b: zeroSchema's permissions hand down rows only when the token's `sub` names the user, and
 * with no token the query still resolves — with zero rows, which is exactly US-A22's symptom.
 *
 * `signal` is loop-r2-05's. The boot path has to give up on a hub that is not answering rather than
 * hold a blank screen while it waits, and `AbortSignal.timeout(4000)` (main.tsx) is how that
 * deadline reaches `fetch` itself; a timeout rejects this promise like any other failure.
 */
export async function fetchZeroToken(
  hubUrl: string = HUB_HTTP_URL,
  signal?: AbortSignal,
): Promise<string> {
  // `signal ?? null`: `RequestInit.signal` is `AbortSignal | null` and this repo compiles with
  // exactOptionalPropertyTypes, so an explicit undefined is not the same thing as an absent key.
  const res = await fetch(`${hubUrl}/api/zero-token`, { signal: signal ?? null });
  if (!res.ok) throw new Error(`zero token fetch failed: HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/** Whether a token has landed. loop-r2-05's connection rule reads it: with no token the answer is
 *  `unreachable` and not `connecting`, because in that case nothing is retrying on its own — Zero
 *  was built without auth and will sit there. */
export function hasZeroToken(): boolean {
  return cachedToken !== undefined;
}

/**
 * Called once at boot (main.tsx) to take the token before the app renders. `initZero` is a
 * synchronous function by contract §7 (Inbox/Thread/AgentSession call it inside a useMemo), and
 * Zero's late-auth path `connection.connect({auth})` does not re-run queries that are already
 * hydrated — the first screen would stay empty (verified 2026-09-20). The token therefore has to
 * ride the constructor.
 */
export async function loadZeroToken(hubUrl?: string, signal?: AbortSignal): Promise<void> {
  cachedToken = await fetchZeroToken(hubUrl, signal);
}

/** zero-cache rejects a token whose JWT `sub` differs from the client's userID
 *  (JWTClaimValidationFailed). */
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
    // With a token, the userID follows its `sub` — changing OMNIS_USER_ID keeps the two in step on
    // their own.
    userID: opts?.userID ?? (auth === undefined ? undefined : jwtSub(auth)) ?? "logan",
    schema: zeroSchema,
    auth,
  });
}

export type ZeroClient = ReturnType<typeof initZero>;

/**
 * Takes the client the shell (App.tsx) put on the ZeroProvider back out of it. `useQuery` from
 * @rocicorp/zero/react calls `useZero()` internally, so without a provider it dies with "useZero
 * must be used within a ZeroProvider" — under the A26~A31 wiring, where each screen called
 * `initZero()` for itself, not one screen rendered in the browser.
 */
export function useZeroClient(): ZeroClient {
  return useZero() as unknown as ZeroClient;
}
