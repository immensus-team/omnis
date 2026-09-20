# CLI probes (2026-09-20, MacBook) — raw evidence for Phase 0 gates ⑦ ⑪ ⑫ ⑭

## claude 2.1.274 (Claude Code)
```
  --bare                                Minimal mode: skip hooks, LSP, plugin
                                        sync, attribution, auto-memory,
                                        background prefetches, keychain reads,
                                        and CLAUDE.md auto-discovery. Sets
                                        CLAUDE_CODE_SIMPLE=1. Anthropic auth is
                                        strictly ANTHROPIC_API_KEY or
                                        apiKeyHelper via --settings (OAuth and
                                        keychain are never read). 3P providers
                                        (Bedrock/Vertex/Foundry) use their own
                                        credentials. Skills still resolve via
                                        /skill-name. Explicitly provide context
                                        via: --system-prompt[-file],
                                        --append-system-prompt[-file], --add-dir
                                        (CLAUDE.md dirs), --mcp-config,
                                        --settings, --agents, --plugin-dir.
  --betas <betas...>                    Beta headers to include in API requests
                                        (API key users only)
  --brief                               Enable SendUserMessage tool for
                                        agent-to-user communication
  --chrome                              Enable Claude in Chrome integration

  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  --permission-prompts <target>         Who answers permission prompts with
                                        --print: "host" (the SDK host or

                                        strictly ANTHROPIC_API_KEY or
                                        apiKeyHelper via --settings (OAuth and
                                        keychain are never read). 3P providers
                                        (Bedrock/Vertex/Foundry) use their own
                                        credentials. Skills still resolve via
                                        /skill-name. Explicitly provide context
--
                                        (CLAUDE.md dirs), --mcp-config,
                                        --settings, --agents, --plugin-dir.
  --betas <betas...>                    Beta headers to include in API requests
                                        (API key users only)
  --brief                               Enable SendUserMessage tool for
                                        agent-to-user communication
--
                                        project and local settings files
                                        (managed settings and --settings still
                                        apply; add --strict-mcp-config to skip
                                        MCP servers too). Also confines the file
                                        tools to the working directories
                                        (--add-dir included), refuses
--
                                        to load (user, project, local).
  --settings <file-or-json>             Path to a settings JSON file or a JSON
                                        string to load additional settings from
  --strict-mcp-config                   Only use MCP servers from --mcp-config,
                                        ignoring all other MCP configurations
  --system-prompt <prompt>              System prompt to use for the session
```

## codex codex-cli 0.155.1
```
[experimental] Generate JSON Schema for the app server protocol

Usage: codex app-server generate-json-schema [OPTIONS] --out <DIR>

Options:
  -c, --config <key=value>
          Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`.
          Use a dotted path (`foo.bar.baz`) to override nested values. The `value` portion is parsed
          as TOML. If it fails to parse as TOML, the raw string is used as a literal.
          
          Examples: - `-c model="o3"` - `-c 'sandbox_permissions=["disk-full-read-access"]'` - `-c
          shell_environment_policy.inherit=all`

  -o, --out <DIR>
          Output directory where the schema bundle will be written
```

## versions
```
worktrunk (brew) 0.78.0 | ollama 0.34.2 | sops 3.13.3 | age 1.3.2 | @tauri-apps/cli 2.11.5 | @rocicorp/zero 1.9.0 | ai 7.0.107
```

## Findings that change gate ⑪ (S-A2-1) — recorded by Fable, 2026-09-20

1. `--bare` skips hooks, CLAUDE.md auto-discovery, plugins, keychain reads. Context can still be supplied explicitly via `--settings`, `--mcp-config`, `--add-dir`, `--system-prompt[-file]`. Whether hooks declared inside a `--settings` file are honored under `--bare` is UNVERIFIED and is the core of gate ⑪.
2. **Under `--bare`, Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`; OAuth and Keychain are never read.** Consequence: a delegated Claude Code run with `--bare` cannot use the Claude subscription (T3) and bills per token on an API key. This contradicts A2-D11's assumption that delegated runs ride the subscription binary. Gate ⑪ must therefore test BOTH modes:
   - (a) `--bare` + omnis hooks via `--settings` + `ANTHROPIC_API_KEY` → cost = API (T2-class pricing).
   - (b) non-bare + `--settings <omnis-hooks.json>` + `--permission-mode manual` + `--disallowedTools` + fresh worktree cwd → subscription auth, but the target repo's own `.claude/settings.json` hooks/CLAUDE.md still load. Measure whether omnis hooks in `--settings` take precedence and whether project hooks can be neutralized.
   - claude-ds (DeepSeek, API key) is unaffected: `--bare` is the natural mode.
3. `--permission-mode` choices (gate ⑫): `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. There is no `default` value; A2 §7.1's profile mapping must use these literals (observe → `plan`, workspace → `manual` or `acceptEdits`, trusted → `bypassPermissions` inside allowed_roots).
4. Codex app-server (0.155.1) ships `generate-json-schema --out <DIR>` and `generate-ts` for the protocol: the pinned protocol schema can be vendored into `packages/protocol` at build time for gate ⑦ and US-A19.

## Gate ⑧ evidence — nomic-embed-text on the Mac mini (M4 16GB), 2026-09-20

Installed `ollama 0.34.2` via brew on the mini, started as a brew service, pulled `nomic-embed-text` (274MB). Benchmark script: `tools/spikes/_probes/embed-bench.py` (stdlib only, run as `python3 /tmp/embed-bench.py` on the mini).

```json
{"total_1000_s": 9.1, "batch50_per_sentence_ms_p50": 10, "batch50_per_sentence_ms_p95": 11, "single_call_ms_p50": 11, "single_call_ms_p95": 11, "dim": 768}
```

Pass criteria (A6 §11.1): 1,000 sentences ≤ 120 s → **9.1 s PASS**; single-call p95 ≤ 300 ms → **11 ms PASS**; dim 768 matches A3 `vector(768)`. Decision: T0 local embedding on the mini is confirmed; no MacBook offload needed for embeddings.

## Gate ⑦ (schema) and ⑭ evidence — 2026-09-20, MacBook

- `codex app-server generate-json-schema --out tools/spikes/_probes/codex-schema` (codex 0.155.1) produced 39 schema files. Method/notification names confirmed present in the schema: `initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `item/started`, `item/completed`, `turn/completed`. The 1-turn round trip (gate ⑦ proper) is still to be run by the spike task; the vendored schema is the pin source for `packages/protocol`.
- worktrunk `wt v0.78.0` requires Git ≥ 2.43. Apple's `/usr/bin/git` is 2.39.5 → installed Homebrew git; `/opt/homebrew/bin` must precede `/usr/bin` in PATH for `wt` (and for the ralph loop). Dry-run result recorded below.
- Gate ⑭ dry run with Homebrew git 2.55.0: `wt switch --create spike/wt-dryrun -y --no-cd` created branch + worktree at `~/AI-Workspaces/omnis.spike-wt-dryrun` (sibling-directory layout is worktrunk's default); `wt remove spike/wt-dryrun -y` removed both worktree and branch. **PASS.** Decision: adopt the sibling layout `~/AI-Workspaces/omnis.<branch>` instead of the contract's `omnis/.worktrees/<story-id>`; the contract §9 line is updated to this.
