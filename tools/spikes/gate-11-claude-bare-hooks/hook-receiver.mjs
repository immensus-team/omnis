#!/usr/bin/env node
// PreToolUse hook: reads { tool_name, tool_input, ... } JSON from stdin and "blocks" with exit
// code 2, which Claude Code treats as requiring approval (the goal is to confirm the hook surface
// itself, so the real bridge socket is only stubbed out).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`GATE11_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(2); // 2 = block + surface reason to the model/user (Claude Code hook contract)
});
