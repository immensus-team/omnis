#!/usr/bin/env node
// A2-D14: fixture NDJSON을 실제 stdio로 재생한다. 실 CLI는 CI에서 부르지 않는다.
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
