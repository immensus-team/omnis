// 0008의 publication 정의를 "무엇이 실제로 WAL에 실리는가"로 확인한다. 컬럼 리스트가
// 어긋나면 pg_publication_tables 대조(zero-publication.test.ts)는 통과해도 비밀이 샐 수 있다.
import { createPool, one, query } from "@omnis/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = createPool();
const SLOT = "omnis_test_zero_slot";

// 슬롯이 남으면 WAL이 무한 적재된다. 테스트가 죽어도 손으로 지울 수 있게 이름을 고정한다:
//   psql -d <testdb> -c "SELECT pg_drop_replication_slot('omnis_test_zero_slot')"
async function dropSlot(): Promise<void> {
  await query(
    pool,
    "SELECT pg_drop_replication_slot($1) FROM pg_replication_slots WHERE slot_name = $1",
    [SLOT],
  );
}

beforeAll(async () => {
  const lvl = await one<{ setting: string }>(
    pool,
    "SELECT setting FROM pg_settings WHERE name = 'wal_level'",
  );
  expect(lvl.setting, "postgresql.conf needs wal_level = logical (A6 §4)").toBe("logical");
  await dropSlot();
  await query(pool, "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [SLOT]);
});

afterAll(async () => {
  await dropSlot();
  await pool.end();
});

async function drain(): Promise<string> {
  const rows = await query<{ text: string }>(
    pool,
    `SELECT encode(data, 'escape') AS text
       FROM pg_logical_slot_get_binary_changes($1, NULL, NULL,
              'proto_version', '4', 'publication_names', 'zero_omnis')`,
    [SLOT],
  );
  return rows.map((r) => r.text).join("\n");
}

describe("durable Item row replication", () => {
  it("carries the item body but not the secret and not the embedding", async () => {
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T_TEST','test')
         ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'C_TEST','group')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind = EXCLUDED.kind RETURNING id`,
      [account.id],
    );
    await drain(); // 준비 INSERT는 버린다

    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, external_id, kind, body, sent_at, embedding)
       VALUES ($1, $2, 'ts_zero_1', 'message', 'ZERO_REPLICATED_BODY', now(), $3::vector)`,
      [thread.id, account.id, `[${Array(768).fill(0.5).join(",")}]`],
    );
    await query(
      pool,
      `INSERT INTO account_secrets (account_id, auth_ref) VALUES ($1, 'omnis.slack.xoxb.T_TEST')
         ON CONFLICT (account_id) DO UPDATE SET auth_ref = EXCLUDED.auth_ref`,
      [account.id],
    );

    const wal = await drain();
    expect(wal).toContain("ZERO_REPLICATED_BODY");
    expect(wal).not.toContain("omnis.slack.xoxb.T_TEST");
    expect(wal).not.toContain("0.5,0.5,0.5");
  });
});
