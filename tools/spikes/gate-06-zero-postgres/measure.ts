import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike", schema });
const id = randomUUID();
const t0 = performance.now();

// ponytail: the query surface is keyed by the table's declared name ("probe_events"),
// not a camelCased schema export name — verified against the running client (z.query
// keys log as ["probe_events"]). Plan text used the camelCase form; fixed here.
const view = z.query.probe_events.where("id", "=", id).materialize();
const seen = new Promise<number>((resolve) => {
  view.addListener((rows) => { if (rows.length > 0) resolve(performance.now()); });
});

execSync(
  `psql omnis_spike_zero -c "INSERT INTO probe_events (id, val) VALUES ('${id}', 'gate-06')"`,
);

const t1 = await seen;
console.log(`latency_ms=${(t1 - t0).toFixed(1)}`);
process.exit(t1 - t0 <= 2000 ? 0 : 1);
