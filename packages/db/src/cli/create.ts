import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "../index.js";

const name = process.argv[2];
if (name === undefined || !/^[a-z0-9_]+$/.test(name)) {
  throw new Error("usage: pnpm db:migrate:create <lower_snake_name>");
}
const existing = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
const last = existing.at(-1);
const nextNum = last === undefined ? 1 : Number(last.slice(0, 4)) + 1;
const file = join(MIGRATIONS_DIR, `${String(nextNum).padStart(4, "0")}_${name}.sql`);
await writeFile(file, `-- ${name}\n`, { flag: "wx" });
console.log(file);
