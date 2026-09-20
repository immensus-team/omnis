// A3 §10 (A3-D13): handle_norm만으로 매칭한다. 표시 이름은 절대 키가 아니다.
import { createHash } from "node:crypto";
import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";

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

/** A3 §10 1단계의 tombstone 추적. 병합 시 평탄화하므로 정상 깊이는 1이지만, 데이터가
 *  깨졌을 때 무한 루프에 빠지지 않도록 상한을 둔다. */
async function followMerges(c: PoolClient, personId: string): Promise<string> {
  let id = personId;
  for (let i = 0; i < 4; i += 1) {
    const rows = await query<{ merged_into: string | null }>(
      c,
      "SELECT merged_into FROM persons WHERE id = $1",
      [id],
    );
    const next = rows[0]?.merged_into ?? null;
    if (next === null) return id;
    id = next;
  }
  return id;
}

/**
 * A3 §10 해석 알고리즘.
 * 1. identities(channel, handle_norm) → 있으면 그 person(merged_into 추적)
 * 2. 없고 이메일이면 교차 채널 결정론적 매칭(같은 handle_norm의 이메일 identity)
 * 3. 그래도 없으면 새 persons + identities(verified=false)
 * 4. 추측 매칭은 하지 않는다 — 표시 이름이 같다는 이유로 붙이지 않는다.
 */
export async function resolvePerson(
  c: PoolClient,
  channel: Channel,
  handle: string,
  display: string,
  roomExternalId?: string,
): Promise<{ person_id: string; created: boolean }> {
  const norm = handleNorm(channel, handle, roomExternalId);

  const existing = await query<{ person_id: string }>(
    c,
    "SELECT person_id FROM identities WHERE channel = $1 AND handle_norm = $2",
    [channel, norm],
  );
  const hit = existing[0];
  if (hit !== undefined) {
    return { person_id: await followMerges(c, hit.person_id), created: false };
  }

  // 2단계는 이메일 키에만 적용된다. 전화번호·슬랙 id는 채널 간에 같은 값을 가질 일이 없다.
  if (norm.includes("@")) {
    const cross = await query<{ person_id: string }>(
      c,
      `SELECT person_id FROM identities
        WHERE handle_norm = $1 AND channel IN ('gmail','outlook','gcal')
        LIMIT 1`,
      [norm],
    );
    const crossHit = cross[0];
    if (crossHit !== undefined) {
      const personId = await followMerges(c, crossHit.person_id);
      await query(
        c,
        `INSERT INTO identities (person_id, channel, handle, handle_norm, display, verified, source)
           VALUES ($1, $2, $3, $4, $5, false, 'adapter')
         ON CONFLICT (channel, handle_norm) DO NOTHING`,
        [personId, channel, handle, norm, display],
      );
      return { person_id: personId, created: false };
    }
  }

  const person = await one<{ id: string }>(
    c,
    "INSERT INTO persons (display_name) VALUES ($1) RETURNING id",
    [display === "" ? norm : display],
  );
  const inserted = await query<{ person_id: string }>(
    c,
    `INSERT INTO identities (person_id, channel, handle, handle_norm, display, verified, source)
       VALUES ($1, $2, $3, $4, $5, false, 'adapter')
     ON CONFLICT (channel, handle_norm) DO NOTHING
     RETURNING person_id`,
    [person.id, channel, handle, norm, display],
  );
  const created = inserted[0];
  if (created === undefined) {
    // 다른 워커가 먼저 만든 경우. 방금 만든 빈 person은 Network 화면에서 지울 수 있다.
    const winner = await one<{ person_id: string }>(
      c,
      "SELECT person_id FROM identities WHERE channel = $1 AND handle_norm = $2",
      [channel, norm],
    );
    return { person_id: await followMerges(c, winner.person_id), created: false };
  }
  return { person_id: person.id, created: true };
}

async function recordIdentityAudit(
  c: PoolClient,
  e: { actor: string; action: string; target_id: string; before: unknown; after: unknown },
): Promise<void> {
  await query(
    c,
    `INSERT INTO audit_log (actor, action, target_table, target_id, before, after)
       VALUES ($1, $2, 'persons', $3, $4::jsonb, $5::jsonb)`,
    [e.actor, e.action, e.target_id, JSON.stringify(e.before), JSON.stringify(e.after)],
  );
}

/** A3 §10 병합 (a)~(e). $from은 지우지 않는다 — tombstone으로 남겨 되돌릴 수 있게 한다. */
export async function mergePersons(
  pool: Pool,
  from: string,
  to: string,
  actor: string,
): Promise<void> {
  if (from === to) throw new Error("cannot merge a person into itself");
  await tx(pool, async (c) => {
    const survivor = await followMerges(c, to);
    if (survivor === from) {
      throw new Error("cannot merge a person into itself (chain resolves back)");
    }

    await query(c, "UPDATE identities SET person_id = $2 WHERE person_id = $1", [from, survivor]);
    await query(c, "UPDATE items SET author_person_id = $2 WHERE author_person_id = $1", [
      from,
      survivor,
    ]);
    // 체인을 평탄화한다 — 해석 1단계의 깊이 상한이 실제로 충분해지는 이유다.
    await query(c, "UPDATE persons SET merged_into = $2 WHERE id = $1 OR merged_into = $1", [
      from,
      survivor,
    ]);
    await query(
      c,
      `INSERT INTO person_merges (kind, from_person_id, to_person_id, reason)
         VALUES ('merge', $1, $2, $3)`,
      [from, survivor, `merged by ${actor}`],
    );
    await recordIdentityAudit(c, {
      actor,
      action: "person.merged",
      target_id: survivor,
      before: { from },
      after: { to: survivor },
    });
  });
}

/**
 * A3 §10 분리. items 재배정은 "그 채널의 thread" 기준이다.
 * ponytail: items에는 handle이 없어서 "이 item이 어느 identity에서 왔는지"를 사후에 복원할 수
 * 없다. 그래서 원 person이 그 채널에 identity를 하나도 안 남기면 전부 옮기고, 하나라도 남으면
 * A3가 지시한 대로 NULL + threads.meta.reassign_needed로 사람에게 넘긴다. items에 identity_id
 * 컬럼이 생기면 이 분기는 사라진다.
 */
export async function splitIdentity(
  pool: Pool,
  identityId: string,
  toPersonId: string | null,
  actor: string,
): Promise<void> {
  await tx(pool, async (c) => {
    const idn = await one<{
      person_id: string;
      channel: Channel;
      display: string | null;
      handle: string;
    }>(c, "SELECT person_id, channel, display, handle FROM identities WHERE id = $1", [identityId]);
    const from = idn.person_id;
    const target =
      toPersonId ??
      (
        await one<{ id: string }>(
          c,
          "INSERT INTO persons (display_name) VALUES ($1) RETURNING id",
          [idn.display ?? idn.handle],
        )
      ).id;
    if (target === from) throw new Error("split target equals the current person");

    await query(c, "UPDATE identities SET person_id = $2 WHERE id = $1", [identityId, target]);

    const remaining = await query<{ id: string }>(
      c,
      "SELECT id FROM identities WHERE person_id = $1 AND channel = $2",
      [from, idn.channel],
    );
    const threads = await query<{ thread_id: string }>(
      c,
      `SELECT DISTINCT i.thread_id FROM items i
         JOIN accounts a ON a.id = i.account_id
        WHERE a.channel = $2 AND i.author_person_id = $1`,
      [from, idn.channel],
    );
    const threadIds = threads.map((t) => t.thread_id);

    if (threadIds.length > 0) {
      if (remaining.length === 0) {
        await query(
          c,
          `UPDATE items SET author_person_id = $3
            WHERE author_person_id = $1 AND thread_id = ANY($2::uuid[])`,
          [from, threadIds, target],
        );
      } else {
        await query(
          c,
          `UPDATE items SET author_person_id = NULL
            WHERE author_person_id = $1 AND thread_id = ANY($2::uuid[])`,
          [from, threadIds],
        );
        await query(
          c,
          `UPDATE threads SET meta = meta || '{"reassign_needed":true}'::jsonb
            WHERE id = ANY($1::uuid[])`,
          [threadIds],
        );
      }
    }

    await query(
      c,
      `INSERT INTO person_merges (kind, from_person_id, to_person_id, identity_ids, reason)
         VALUES ('split', $1, $2, $3::uuid[], $4)`,
      [from, target, [identityId], `split by ${actor}`],
    );
    await recordIdentityAudit(c, {
      actor,
      action: "person.split",
      target_id: target,
      before: { from, identityId },
      after: { to: target, auto_reassigned: remaining.length === 0 },
    });
  });
}
