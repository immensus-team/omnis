import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike13", schema });
const threadId = randomUUID();
const p1 = randomUUID();
const p2 = randomUUID();

execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_threads (id, participants) VALUES ('${threadId}', ARRAY['${p1}','${p2}']::uuid[])"`,
);
execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_items (id, thread_id, body) VALUES (gen_random_uuid(), '${threadId}', 'hello from gate 13')"`,
);

// ponytail: gate-06 found the query surface is keyed by the declared table name
// ("probe_threads"/"probe_items"), not the camelCased schema export name.
async function waitFor<T>(query: { materialize(): { data: T; addListener(cb: (v: T) => void): () => void } }, pred: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const view = query.materialize();
  if (pred(view.data)) return view.data;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for sync")), timeoutMs);
    const unlisten = view.addListener((v) => {
      if (pred(v)) {
        clearTimeout(timer);
        unlisten();
        resolve(v);
      }
    });
  });
}

const thread = await waitFor(
  z.query.probe_threads.where("id", "=", threadId).one(),
  (v) => v != null,
);
const items = await waitFor(
  z.query.probe_items.where("threadId", "=", threadId),
  (v) => Array.isArray(v) && v.length > 0,
);

console.log("thread:", JSON.stringify(thread));
console.log("items:", JSON.stringify(items));
const pass = Array.isArray((thread as any)?.participants) && (thread as any).participants.length === 2 && items.length === 1;
console.log(`gate13_pass=${pass}`);
process.exit(pass ? 0 : 1);
