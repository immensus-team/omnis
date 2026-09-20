export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
  /** Keychain omnis.bridge.token.<host>의 값을 A6 래퍼가 주입한다. 빈 문자열이면 WS /bridge를 닫는다. */
  bridgeToken: string;
  /** Zero 토큰의 `sub`. permissions가 이 값과 비교한다(packages/kernel/src/zero-schema.ts). */
  userId: string;
  /** zero-cache의 ZERO_AUTH_SECRET과 같은 값. 비어 있으면 /api/zero-token이 503이다. */
  zeroAuthSecret: string;
}

export const HUB_VERSION = "0.1.0";

/** 마스터 §4.2: 허브는 127.0.0.1:8787에만 bind한다. Tailscale Serve가 /api/로 노출한다. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === "") {
    throw new Error("DATABASE_URL is required (계약 §9)");
  }
  const raw = env.OMNIS_HUB_PORT ?? "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`OMNIS_HUB_PORT must be an integer port, got ${raw}`);
  }
  if (port === 8642) {
    throw new Error("port 8642 belongs to Hermes api_server (마스터 §4.2) — pick another");
  }
  return {
    port,
    host: "127.0.0.1",
    version: HUB_VERSION,
    bridgeToken: env.OMNIS_BRIDGE_TOKEN ?? "",
    userId: env.OMNIS_USER_ID ?? "logan",
    zeroAuthSecret: env.ZERO_AUTH_SECRET ?? "",
  };
}
