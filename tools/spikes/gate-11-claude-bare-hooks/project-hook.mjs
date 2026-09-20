#!/usr/bin/env node
// project's own PreToolUse hook (fixture) — uses a marker distinct from the omnis hook to prove
// only that "the project hook fired".
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`PROJECT_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(0); // 0 = allow — we only need to prove it fired; this hook need not block execution
});
