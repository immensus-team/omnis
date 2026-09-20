#!/usr/bin/env node
// PreToolUse hook: stdin으로 { tool_name, tool_input, ... } JSON을 받아 exit code 2로 "차단"하면
// Claude Code가 이를 승인 필요로 취급한다(hook 표면 자체 확인이 목적이라 실제 브리지 소켓은 흉내만 낸다).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`GATE11_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(2); // 2 = block + surface reason to the model/user (Claude Code hook contract)
});
