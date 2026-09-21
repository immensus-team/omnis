// A5 §3.5's quick-add is a write, so the thing worth testing is the HTTP contract the screen sees —
// the status and the body, not the SQL string. This boots the real hub server over a real pool, the
// way apps/hub/test/integration/routes.test.ts does, against the per-branch DATABASE_URL (a fake
// pool would prove the route is wired to *a* query, not that the row lands in `tasks`).
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { createKernel, createLogger } from "@omnis/kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUB_VERSION, type HubConfig } from "./config.js";
import { createHubServer } from "./http.js";
import { TASK_TITLE_MAX_CHARS, setTaskState } from "./tasks.js";

function testConfig(): HubConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    version: HUB_VERSION,
    bridgeToken: "",
    userId: "logan",
    zeroAuthSecret: "",
    googleOAuthClientId: "",
    googleOAuthClientSecret: "",
    outlookClientId: "",
    ntfyUrl: "http://127.0.0.1:2586",
    webpushVapidPublic: "",
    webpushVapidPrivate: "",
    webpushSubject: "mailto:test@example.com",
  };
}

interface TaskBody {
  id: string;
  title: string;
  state: string;
  created_at: string;
}

let base = "";
let pool: ReturnType<typeof createPool>;
let close: () => Promise<void>;
/** Every title this file writes, so afterAll can take its own rows back out of the branch DB. */
const writtenIds: string[] = [];

function post(body: string): Promise<Response> {
  return fetch(`${base}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function postTask(title: string): Promise<{ status: number; body: TaskBody }> {
  const res = await post(JSON.stringify({ title }));
  const body = (await res.json()) as TaskBody;
  if (res.status === 201) writtenIds.push(body.id);
  return { status: res.status, body };
}

beforeAll(async () => {
  pool = createPool();
  const kernel = createKernel({ pool });
  const server = createHubServer({
    kernel,
    pool,
    config: testConfig(),
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await kernel.close();
    await pool.end();
  };
});

afterAll(async () => {
  if (writtenIds.length > 0) {
    await query(pool, "DELETE FROM tasks WHERE id = ANY($1::uuid[])", [writtenIds]);
  }
  await close();
});

describe("POST /tasks (A5 §3.5 quick-add)", () => {
  it("creates the undated todo and answers 201 with the stored row", async () => {
    const res = await post(JSON.stringify({ title: "Send Dana the slides" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as TaskBody;
    writtenIds.push(body.id);
    expect(body.title).toBe("Send Dana the slides");
    // `open` is the migration's default and the state the screen's four tabs list; the row the
    // quick-add writes is a plain todo, not a delegation.
    expect(body.state).toBe("open");
    expect(typeof body.id).toBe("string");
    expect(typeof body.created_at).toBe("string");
  });

  it("stores the row it just answered with", async () => {
    const { status, body } = await postTask("Book the room for Thursday");
    expect(status).toBe(201);
    const rows = await query<{
      title: string;
      kind: string;
      owner_kind: string;
      created_by: string;
      due_at: string | null;
    }>(pool, "SELECT title, kind, owner_kind, created_by, due_at FROM tasks WHERE id = $1", [
      body.id,
    ]);
    expect(rows).toEqual([
      {
        title: "Book the room for Thursday",
        kind: "todo",
        owner_kind: "me",
        created_by: "me",
        // No due date is the point: an undated task is what the Someday tab lists, and a quick-add
        // that silently invented one would hide the task from the view it belongs in.
        due_at: null,
      },
    ]);
  });

  it("trims the title before it is stored", async () => {
    const { status, body } = await postTask("  Water the fig tree  ");
    expect(status).toBe(201);
    expect(body.title).toBe("Water the fig tree");
  });

  it("refuses a title that is empty once trimmed", async () => {
    const res = await post(JSON.stringify({ title: "   " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `task title must be 1..${String(TASK_TITLE_MAX_CHARS)} characters`,
    });
  });

  it("refuses a title past the cap", async () => {
    const res = await post(JSON.stringify({ title: "x".repeat(TASK_TITLE_MAX_CHARS + 1) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: `task title must be 1..${String(TASK_TITLE_MAX_CHARS)} characters`,
    });
  });

  it("refuses a body whose title is not a string", async () => {
    for (const json of [JSON.stringify({}), JSON.stringify({ title: 42 }), "null"]) {
      const res = await post(json);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "expected { title: string }" });
    }
  });

  it("answers 400 for a body that is not json", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json body" });
  });

  it("answers 405 for anything but POST", async () => {
    const res = await fetch(`${base}/tasks`);
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });
});

// loop-r2-06/L2-04: the checkbox the Tasks screen draws had no writer at all — `App.tsx` rendered
// `<Tasks />` without `onToggleDone`, so the box flipped back under the finger and the row was
// never touched. This is the write, asserted on the row it leaves behind: a 200 whose body says
// `done` over a row still at `open` would be the same lie one layer down.
describe("POST /tasks/:id/state (loop-r2-06 — the checkbox's write)", () => {
  function postState(id: string, body: string): Promise<Response> {
    return fetch(`${base}/tasks/${id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  }

  async function storedState(id: string): Promise<{ state: string; done_at: string | null }> {
    const rows = await query<{ state: string; done_at: Date | null }>(
      pool,
      "SELECT state, done_at FROM tasks WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`task ${id} is gone`);
    return { state: row.state, done_at: row.done_at === null ? null : String(row.done_at) };
  }

  it("marks a task done and back to open, stamping and clearing done_at", async () => {
    const { body } = await postTask("Tick the box");
    expect((await storedState(body.id)).done_at).toBeNull();

    const done = await postState(body.id, JSON.stringify({ state: "done" }));
    expect(done.status).toBe(200);
    expect(((await done.json()) as TaskBody).state).toBe("done");
    // `done_at` is the row's own record of when, and the reason reopening has to clear it: a task
    // that is open again is not a task that was finished at some earlier moment.
    const afterDone = await storedState(body.id);
    expect(afterDone.state).toBe("done");
    expect(afterDone.done_at).not.toBeNull();

    const open = await postState(body.id, JSON.stringify({ state: "open" }));
    expect(open.status).toBe(200);
    expect(((await open.json()) as TaskBody).state).toBe("open");
    const afterOpen = await storedState(body.id);
    expect(afterOpen.state).toBe("open");
    expect(afterOpen.done_at).toBeNull();
  });

  it("takes the optional /api prefix the thread routes take", async () => {
    const { body } = await postTask("Prefixed route");
    const res = await fetch(`${base}/api/tasks/${body.id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "done" }),
    });
    expect(res.status).toBe(200);
    expect((await storedState(body.id)).state).toBe("done");
  });

  it("answers 404 for an id no row carries, and changes nothing", async () => {
    const res = await postState(randomUUID(), JSON.stringify({ state: "done" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "task not found" });
  });

  it("answers 400 for a state the column does not hold", async () => {
    const { body } = await postTask("Not a state");
    for (const json of [
      JSON.stringify({ state: "nope" }),
      JSON.stringify({ state: "in_progress" }),
      JSON.stringify({}),
      JSON.stringify({ state: 7 }),
      "null",
    ]) {
      const res = await postState(body.id, json);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "expected { state: 'done' | 'open' }" });
    }
    // The refusal is a refusal: the row is exactly where it was.
    expect((await storedState(body.id)).state).toBe("open");
  });

  it("answers 400 for a body that is not json, and 405 for a GET", async () => {
    const { body } = await postTask("Bad request shape");
    const bad = await postState(body.id, "{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid json body" });

    const wrongMethod = await fetch(`${base}/tasks/${body.id}/state`);
    expect(wrongMethod.status).toBe(405);
    expect(await wrongMethod.json()).toEqual({ error: "method not allowed" });
  });
});

// The screen calls the function through the route, but the function is the contract the route is a
// thin wrapper around — and the null it answers with is what makes the 404 above possible.
describe("setTaskState (loop-r2-06)", () => {
  it("returns null for an id no row carries", async () => {
    expect(await setTaskState(pool, randomUUID(), "done")).toBeNull();
  });

  it("returns the updated row and nothing else about it", async () => {
    const { body } = await postTask("Returned row");
    const row = await setTaskState(pool, body.id, "done");
    expect(row?.id).toBe(body.id);
    expect(row?.title).toBe("Returned row");
    expect(row?.state).toBe("done");
  });
});
