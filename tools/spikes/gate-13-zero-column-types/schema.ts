import { createSchema, table, string, json, definePermissions, ANYONE_CAN } from "@rocicorp/zero";

export const probeThreads = table("probe_threads")
  .columns({ id: string(), participants: json<string[]>() })
  .primaryKey("id");

// embedding/search_tsv intentionally omitted — the columns are excluded from the
// publication (setup.sql: `probe_items (id, thread_id, body)`), so the Zero schema
// must match that narrowed column list.
export const probeItems = table("probe_items")
  .columns({ id: string(), threadId: string().from("thread_id"), body: string() })
  .primaryKey("id");

// ponytail: gate-06 found `z.query.<table>` is the deprecated "legacy queries" surface,
// undefined unless enableLegacyQueries is set (verified against installed 1.9.0).
export const schema = createSchema({
  tables: [probeThreads, probeItems],
  enableLegacyQueries: true,
});
export type Schema = typeof schema;

// ponytail: gate-06 found zero-cache-dev silently syncs 0 rows for any table with no
// permissions rule. Disposable local scratch DB, so ANYONE_CAN read is fine here.
export const permissions = definePermissions<unknown, Schema>(schema, () => ({
  probe_threads: { row: { select: ANYONE_CAN } },
  probe_items: { row: { select: ANYONE_CAN } },
}));
