export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
  /** Value of Keychain omnis.bridge.token.<host>, injected by the A6 wrapper. Empty closes the WS /bridge. */
  bridgeToken: string;
  /** The Zero token's `sub`. permissions compares against this value (packages/kernel/src/zero-schema.ts). */
  userId: string;
  /** Same value as zero-cache's ZERO_AUTH_SECRET. Empty makes /api/zero-token return 503. */
  zeroAuthSecret: string;
  /** App-level OAuth clients (Phase A contract §9). These are the *app's* credentials, not a
   *  per-account secret — an empty value means that channel's adapter is not configured at all, and
   *  its accounts are logged as skipped at boot (no credentials exist yet — US-B45). */
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  outlookClientId: string;
  /** self-hosted ntfy (A6 §8, delta §9). Adapter health failures surface here as well as in a system Item. */
  ntfyUrl: string;
  /** Web Push VAPID keypair (delta §9, Keychain omnis.webpush.vapid_*). Empty means push is not
   *  configured at all: /push/* answers 503 and nothing can be subscribed. The *sender* that calls
   *  setVapidDetails with these is @omnis/kernel's sendWebPush (single owner, cross review
   *  M-webpush); the hub only reports the public key to the browser. */
  webpushVapidPublic: string;
  webpushVapidPrivate: string;
  /** The VAPID `sub` claim — a mailto: or URL the push service can reach the operator at.
   *  Same env name and default as @omnis/kernel's vapidFromEnv, so the hub's "is it configured"
   *  check and the sender's key loading never disagree. */
  webpushSubject: string;
}

export const HUB_VERSION = "0.1.0";

/** Master §4.2: the hub binds to 127.0.0.1:8787 only. Tailscale Serve exposes it under /api/. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === "") {
    throw new Error("DATABASE_URL is required (contract §9)");
  }
  const raw = env.OMNIS_HUB_PORT ?? "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`OMNIS_HUB_PORT must be an integer port, got ${raw}`);
  }
  if (port === 8642) {
    throw new Error("port 8642 belongs to Hermes api_server (master §4.2) — pick another");
  }
  return {
    port,
    host: "127.0.0.1",
    version: HUB_VERSION,
    bridgeToken: env.OMNIS_BRIDGE_TOKEN ?? "",
    userId: env.OMNIS_USER_ID ?? "logan",
    zeroAuthSecret: env.ZERO_AUTH_SECRET ?? "",
    googleOAuthClientId: env.OMNIS_GOOGLE_OAUTH_CLIENT_ID ?? "",
    googleOAuthClientSecret: env.OMNIS_GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    outlookClientId: env.OMNIS_OUTLOOK_CLIENT_ID ?? "",
    ntfyUrl: env.OMNIS_NTFY_URL ?? "http://127.0.0.1:2586",
    webpushVapidPublic: env.OMNIS_WEBPUSH_VAPID_PUBLIC ?? "",
    webpushVapidPrivate: env.OMNIS_WEBPUSH_VAPID_PRIVATE ?? "",
    webpushSubject: env.OMNIS_WEBPUSH_SUBJECT ?? "mailto:omnis@localhost",
  };
}
