import { zeroSchema } from "@omnis/kernel/zero";
import { Zero } from "@rocicorp/zero";
import { useZero } from "@rocicorp/zero/react";

// Same shape as apps/desktop/src/zero-client.ts (interface contract §7): the PWA reads the same
// replicated tables through the same zero-cache. An empty OMNIS_HUB_HTTP_URL means "same origin",
// which is what the dev server's proxy provides (vite.config.ts).
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

let cachedToken: string | undefined;

/** zeroSchema's permissions hand down no rows at all without a hub-signed token — the queries
 *  resolve and return zero rows, which reads as an empty inbox rather than as an error. */
export async function fetchZeroToken(hubUrl: string = HUB_HTTP_URL): Promise<string> {
  const res = await fetch(`${hubUrl}/api/zero-token`);
  if (!res.ok) throw new Error(`zero token fetch failed: HTTP ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

/** Called once at boot (main.tsx) so the token is on the constructor. Zero's later-auth path
 *  `connection.connect({auth})` does not re-run queries that have already hydrated, which leaves
 *  the first screen empty until something else invalidates it. */
export async function loadZeroToken(hubUrl?: string): Promise<void> {
  cachedToken = await fetchZeroToken(hubUrl);
}

/** zero-cache rejects the token when the JWT's `sub` and the client userID disagree. */
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
    userID: opts?.userID ?? (auth === undefined ? undefined : jwtSub(auth)) ?? "logan",
    schema: zeroSchema,
    auth,
  });
}

export type ZeroClient = ReturnType<typeof initZero>;

export function useZeroClient(): ZeroClient {
  return useZero() as unknown as ZeroClient;
}
