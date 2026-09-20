// A3 §10 (A3-D13): match on handle_norm alone. The display name is never a key.
import { createHash } from "node:crypto";
import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";

const UNIT_SEPARATOR = ""; // Separator fixed by A3 §10 (0x1f)

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

/** ponytail: no libphonenumber. Input is either the E.164 the channel handed us or a Korean
 *  number — those are the only two cases. If local numbers from other countries really start
 *  showing up, add the library then. */
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
      // A3 §10: KakaoTalk has no stable user id. Narrow the scope to "this name in this room"
      // and only ever create it with verified=false. The room is threads.external_id.
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

/** B-D3: avatars are initials only. Do not add a persons.avatar_url column. */
export function initialsFor(displayName: string): string {
  const tokens = displayName
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");
  const first = tokens[0];
  if (first === undefined) return "?";
  if (/[가-힣]/.test(first)) {
    // Hangul (Korean): the family name is a single character, so the two characters of the
    // given name identify a person better.
    return first.length >= 3 ? first.slice(1, 3) : first;
  }
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && last !== undefined) {
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
  }
  return first.slice(0, 2).toUpperCase();
}

/** Tombstone chasing for step 1 of A3 §10. Merges flatten the chain, so the usual depth is 1,
 *  but cap it so corrupt data cannot spin forever. */
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
 * A3 §10 resolution algorithm.
 * 1. identities(channel, handle_norm) → if present, that person (following merged_into)
 * 2. otherwise, for email, deterministic cross-channel matching (an email identity with the
 *    same handle_norm)
 * 3. still nothing → new persons + identities(verified=false)
 * 4. no guesswork matching — never join identities just because display names match.
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

  // Step 2 applies only to email keys. Phone numbers and Slack ids never share a value
  // across channels.
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
    // Another worker got there first. The empty person we just created can be deleted from
    // the Network screen.
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

/** A3 §10 merge (a)–(e). $from is not deleted — it stays as a tombstone so the merge can be
 *  undone. */
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
    // Flatten the chain — that is why the depth cap in step 1 of resolution is actually enough.
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
 * A3 §10 split. Item reassignment is scoped to "threads on that channel".
 * ponytail: items carry no handle, so "which identity did this item come from" cannot be
 * reconstructed after the fact. So if the original person has no identity left on that channel we
 * move everything; if even one remains we follow A3 and hand it to a human via NULL +
 * threads.meta.reassign_needed. This branch disappears once items gets an identity_id column.
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
