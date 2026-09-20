// 0008_publication.sql(SQL)과 zero-schema.ts(TS)는 사람이 두 곳에 같은 목록을 적는 구조라
// 반드시 어긋난다. 어긋나면 zero-cache가 조용히 빈 테이블을 싱크하므로, 허브 부팅 때 깨뜨린다.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import { ZERO_ITEM_COLUMNS, ZERO_LABEL_RULE_COLUMNS, ZERO_TABLES } from "./zero-schema.js";

export class ZeroPublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZeroPublicationError";
  }
}

const NARROWED: Record<string, readonly string[]> = {
  items: ZERO_ITEM_COLUMNS,
  label_rules: ZERO_LABEL_RULE_COLUMNS,
};

export async function assertZeroPublication(pool: Pool): Promise<void> {
  const rows = await query<{ tablename: string; attnames: string[] }>(
    pool,
    "SELECT tablename, attnames::text[] AS attnames FROM pg_publication_tables WHERE pubname = 'zero_omnis'",
  );
  if (rows.length === 0) {
    throw new ZeroPublicationError("publication zero_omnis not found — run pnpm db:migrate");
  }
  const actual = new Set(rows.map((r) => r.tablename));
  const missing = ZERO_TABLES.filter((t) => !actual.has(t));
  const extra = [...actual].filter((t) => !ZERO_TABLES.includes(t));
  if (missing.length > 0 || extra.length > 0) {
    throw new ZeroPublicationError(
      `zero_omnis table set differs from zeroSchema: missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    );
  }
  for (const row of rows) {
    const expected = NARROWED[row.tablename];
    if (!expected) continue;
    const got = [...row.attnames].sort().join(",");
    const want = [...expected].sort().join(",");
    if (got !== want) {
      throw new ZeroPublicationError(
        `zero_omnis.${row.tablename} columns differ: got=[${got}] want=[${want}]`,
      );
    }
  }
}
