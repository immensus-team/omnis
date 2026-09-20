export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
  /** Keychain omnis.bridge.token.<host>의 값을 A6 래퍼가 주입한다. 빈 문자열이면 WS /bridge를 닫는다. */
  bridgeToken: string;
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
  };
}
