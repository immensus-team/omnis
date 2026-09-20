#!/usr/bin/env node
// A2-D14: replays the fixture NDJSON over a real stdio. The real CLI is not invoked in CI.
import { readFileSync } from "node:fs";

const fixture = process.env.OMNIS_MOCK_FIXTURE;
if (typeof fixture !== "string") {
  process.stderr.write("OMNIS_MOCK_FIXTURE is required\n");
  process.exit(2);
}

for (const line of readFileSync(fixture, "utf8").split("\n")) {
  if (line.trim().length > 0) process.stdout.write(`${line}\n`);
}
process.stdout.end();
