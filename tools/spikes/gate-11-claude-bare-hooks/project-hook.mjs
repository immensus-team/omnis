#!/usr/bin/env node
// project's own PreToolUse hook (fixture) — omnis hook과 별개의 마커로 "project hook이 떴는지"만 증명한다.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`PROJECT_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(0); // 0 = allow — 발동 여부만 증명하면 되고 이 hook이 실행을 막을 필요는 없다
});
