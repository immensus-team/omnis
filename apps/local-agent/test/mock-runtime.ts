import { type SpawnOptions, spawn } from "node:child_process";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;

export const FIXTURES = {
  claudeToolCall: join(here, "fixtures", "claude_code", "tool_call_turn.ndjson"),
  claudeUnknownItem: join(here, "fixtures", "claude_code", "unknown_item_turn.ndjson"),
  codexToolCall: join(here, "fixtures", "codex", "tool_call_turn.ndjson"),
} as const;

/** Makes it take the very code path RuntimeAdapter uses to read stdio (A2 §8.2). */
export function mockSpawn(fixture: string): typeof spawn {
  return ((_cmd: string, _args: readonly string[], opts?: SpawnOptions) =>
    spawn(process.execPath, [join(here, "mock-runtime.mjs")], {
      ...opts,
      env: { ...process.env, OMNIS_MOCK_FIXTURE: fixture },
    })) as typeof spawn;
}
