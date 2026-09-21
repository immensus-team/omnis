// A2 §5.1: the bridge accepts delegate.run / capture.send only with an approval the hub signed.
// Both ends already hold the bridge token (omnis.bridge.token.<host>), so an HMAC needs no new secret.
import { createHmac, timingSafeEqual } from "node:crypto";

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function signApproval(token: string, approvalId: string, payload: unknown): string {
  return createHmac("sha256", token)
    .update(`${approvalId}\n${canonicalJson(payload)}`)
    .digest("hex");
}

export function verifyApproval(
  token: string,
  approvalId: string,
  payload: unknown,
  sig: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const want = Buffer.from(signApproval(token, approvalId, payload), "hex");
  return timingSafeEqual(want, Buffer.from(sig, "hex"));
}
