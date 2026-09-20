import { createSchema, table, string, number, definePermissions, ANYONE_CAN } from "@rocicorp/zero";

// ponytail: @rocicorp/zero 1.9.0 has no `timestamp()` column helper (verified against
// the installed package's exports — only boolean/enumeration/json/number/string exist).
// Zero replicates Postgres timestamptz as epoch-ms, so `number()` is the correct type
// for createdAt here; this is a plan deviation (plan text used `timestamp()`).
export const probeEvents = table("probe_events")
  .columns({ id: string(), val: string(), createdAt: number().from("created_at") })
  .primaryKey("id");

// ponytail: `z.query.<table>` (the plan's API) is the deprecated "legacy queries" surface
// in 1.9.0 and is `undefined` unless explicitly opted into (verified against the
// installed package's schema-query.d.ts: ConditionalSchemaQuery is undefined unless
// enableLegacyQueries is true). Non-legacy alternative is createBuilder/defineQuery.
export const schema = createSchema({ tables: [probeEvents], enableLegacyQueries: true });
export type Schema = typeof schema;

// ponytail: zero-cache-dev refuses to sync ANY table without a deployed permissions
// config (verified: startup log said "No permissions found at schema.ts ... no tables
// will be syncable" and queries returned 0 rows even for data that existed upstream).
// The plan's schema.ts had none. This is a disposable local scratch table, so ANYONE_CAN
// read is fine for the spike; production schemas need real rules (not in this plan step).
export const permissions = definePermissions<unknown, Schema>(schema, () => ({
  probe_events: { row: { select: ANYONE_CAN } },
}));
