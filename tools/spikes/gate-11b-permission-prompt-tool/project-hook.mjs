#!/usr/bin/env node
// project's own PreToolUse hook (fixture) — proves whether project hooks still fire when
// --permission-prompt-tool is the approval surface. Copied from gate-11's fixture (same shape,
// different marker) so this gate dir is self-contained. exit 0 = allow, doesn't block.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`GATE11B_PROJECT_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(0);
});
