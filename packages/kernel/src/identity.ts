// A3 §10 (A3-D13): handle_norm만으로 매칭한다. 표시 이름은 절대 키가 아니다.
import { createHash } from "node:crypto";
import type { Channel } from "@omnis/protocol";

const UNIT_SEPARATOR = ""; // A3 §10이 고정한 구분자(0x1f)

function normalizeEmail(raw: string, collapseDots: boolean): string {
  const trimmed = raw.trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (collapseDots) local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

/** ponytail: libphonenumber를 붙이지 않는다. 입력은 채널이 준 E.164이거나 한국 번호 둘 중
 *  하나다. 다른 나라 로컬 번호가 실제로 들어오면 그때 라이브러리를 넣는다. */
function toE164(raw: string): string {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return `+${cleaned.slice(1).replace(/\D/g, "")}`;
  const bare = cleaned.replace(/\D/g, "");
  if (bare.startsWith("0")) return `+82${bare.slice(1)}`;
  return `+${bare}`;
}

export function handleNorm(channel: Channel, raw: string, roomExternalId?: string): string {
  switch (channel) {
    case "gmail":
    case "gcal":
      return normalizeEmail(raw, true);
    case "outlook":
      return normalizeEmail(raw, false);
    case "telegram":
    case "whatsapp":
      return toE164(raw);
    case "slack": {
      const v = raw.trim();
      if (!/^[^:\s]+:[^:\s]+$/.test(v)) {
        throw new Error(`slack handle must be team_id:user_id, got: ${v}`);
      }
      return v;
    }
    case "linkedin": {
      const m = /\/in\/([^/?#]+)/.exec(raw.trim());
      return (m?.[1] ?? raw.trim()).toLowerCase();
    }
    case "kakaotalk": {
      // A3 §10: 카톡은 안정적인 사용자 id가 없다. "이 방의 이 이름"으로 스코프를 좁히고
      // verified=false로만 만든다. room은 threads.external_id다.
      if (roomExternalId === undefined || roomExternalId === "") {
        throw new Error("kakaotalk handle_norm requires room_external_id (A3 §10)");
      }
      const key = `${raw.trim().toLowerCase()}${UNIT_SEPARATOR}${roomExternalId}`;
      return `kt:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
    }
    default:
      return raw.trim().toLowerCase();
  }
}

/** B-D3: 아바타는 이니셜만. persons.avatar_url 컬럼을 만들지 않는다. */
export function initialsFor(displayName: string): string {
  const tokens = displayName
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");
  const first = tokens[0];
  if (first === undefined) return "?";
  if (/[가-힣]/.test(first)) {
    // 한국 이름은 성이 한 글자다 — 이름 두 글자가 사람을 더 잘 가른다.
    return first.length >= 3 ? first.slice(1, 3) : first;
  }
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && last !== undefined) {
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
  }
  return first.slice(0, 2).toUpperCase();
}
