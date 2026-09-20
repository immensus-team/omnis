import { describe, expect, it } from "vitest";
import {
  ZERO_ITEM_COLUMNS,
  ZERO_LABEL_RULE_COLUMNS,
  ZERO_TABLES,
  permissions,
  zeroSchema,
} from "../src/zero-schema.js";

const EXPECTED_TABLES = [
  "accounts",
  "threads",
  "items",
  "calendar_events",
  "persons",
  "identities",
  "labels",
  "label_rules",
  "item_labels",
  "thread_labels",
  "tasks",
  "agent_runtimes",
  "agent_sessions",
  "pending_approvals",
  "notes",
  "digests",
  "settings",
];

// Tables excluded by A3 §7. One leak sends secrets, audit data, and 768d embeddings to the phone.
const FORBIDDEN_TABLES = [
  "account_secrets",
  "events",
  "audit_log",
  "agent_runs",
  "memories",
  "entities",
  "relations",
  "person_merges",
  "jobs",
];

describe("zeroSchema", () => {
  it("replicates exactly the 17 tables A3 §7 + delta §6 list", () => {
    expect([...ZERO_TABLES].sort()).toEqual([...EXPECTED_TABLES].sort());
    expect(Object.keys(zeroSchema.tables).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it("never replicates a forbidden table", () => {
    for (const t of FORBIDDEN_TABLES) {
      expect(Object.keys(zeroSchema.tables)).not.toContain(t);
    }
  });

  it("narrows items to the 24 columns of the publication", () => {
    expect(ZERO_ITEM_COLUMNS).toHaveLength(24);
    expect(ZERO_ITEM_COLUMNS).not.toContain("embedding");
    expect(ZERO_ITEM_COLUMNS).not.toContain("search_tsv");
    expect(Object.keys(zeroSchema.tables.items.columns).sort()).toEqual(
      [...ZERO_ITEM_COLUMNS].sort(),
    );
  });

  it("drops probe_embedding from label_rules", () => {
    expect(ZERO_LABEL_RULE_COLUMNS).not.toContain("probe_embedding");
    expect(Object.keys(zeroSchema.tables.label_rules.columns)).not.toContain("probe_embedding");
  });

  it("drops the generated attendees_count from calendar_events", () => {
    expect(Object.keys(zeroSchema.tables.calendar_events.columns)).not.toContain("attendees_count");
  });
});

// US-A21b: without permissions, zero-cache sends nothing ("no tables will be syncable").
describe("zero permissions (US-A21b)", () => {
  it("grants select on every replicated table and no writes at all", async () => {
    const compiled = await permissions;
    expect(compiled).toBeDefined();
    const tables = compiled?.tables ?? {};
    expect(Object.keys(tables).sort()).toEqual([...EXPECTED_TABLES].sort());
    for (const [name, perms] of Object.entries(tables)) {
      expect(perms.row?.select, `${name} select`).toBeDefined();
      expect(perms.row?.insert, `${name} insert`).toBeUndefined();
      expect(perms.row?.update?.preMutation, `${name} update`).toBeUndefined();
      expect(perms.row?.update?.postMutation, `${name} update`).toBeUndefined();
      expect(perms.row?.delete, `${name} delete`).toBeUndefined();
    }
  });
});
