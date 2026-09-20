import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0003_labels", () => {
  it("enforces labels_kind_ck and the (kind, name) unique key", async () => {
    await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('work','scope') RETURNING id`,
    );
    await expect(
      query(pool, `INSERT INTO labels (name, kind) VALUES ('work','scope')`),
    ).rejects.toThrow(/labels_uq/);
    await expect(
      query(pool, `INSERT INTO labels (name, kind) VALUES ('nope','not-a-kind')`),
    ).rejects.toThrow(/labels_kind_ck/);
  });

  it("stores a label_rule with uuid arrays and a 768d probe embedding", async () => {
    const label = await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('invoices','topic') RETURNING id`,
    );
    const rule = await one<{ tier: string; active: boolean; positives: string[] }>(
      pool,
      `INSERT INTO label_rules (label_id, prompt, probe_embedding)
       VALUES ($1, '청구서가 첨부된 메일', $2::vector)
       RETURNING tier, active, positives`,
      [label.id, `[${new Array(768).fill(0).join(",")}]`],
    );
    expect(rule.tier).toBe("T0");
    expect(rule.active).toBe(true);
    expect(rule.positives).toEqual([]);

    await expect(
      query(pool, `INSERT INTO label_rules (label_id, prompt, tier) VALUES ($1,'x','T9')`, [label.id]),
    ).rejects.toThrow(/label_rules_tier_ck/);
  });

  it("uses composite primary keys on item_labels and thread_labels and restricts `by`", async () => {
    const cols = await query<{ table_name: string; column_name: string }>(
      pool,
      `SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name IN ('item_labels','thread_labels')
        ORDER BY kcu.table_name, kcu.column_name`,
    );
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "item_labels.item_id",
      "item_labels.label_id",
      "thread_labels.label_id",
      "thread_labels.thread_id",
    ]);

    const label = await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('urgent','priority') RETURNING id`,
    );
    const thread = await one<{ id: string }>(pool, `SELECT id FROM threads LIMIT 1`);
    await expect(
      query(pool, `INSERT INTO thread_labels (thread_id, label_id, by) VALUES ($1,$2,'robot')`, [
        thread.id,
        label.id,
      ]),
    ).rejects.toThrow(/thread_labels_by_ck/);
  });
});
