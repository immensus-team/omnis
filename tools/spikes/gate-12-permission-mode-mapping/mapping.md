# Confirmed permission-mode ↔ profile mapping (gate-12, S-A2-2)

| profile (A2 §7.1) | `--permission-mode` | Rationale |
|---|---|---|
| `observe` | `plan` | Read-only planning mode with no file writes or tool execution. Exclusive to the `inbox:*` loop (A2 §7.1) |
| `workspace` | `manual` | Writes files under cwd; all other tools prompt for approval (via hook, gate-11) |
| `trusted` | `bypassPermissions` | Only with `origin:'human'`, within allowed_roots (A2 §7.1 "bypassPermissions only with trusted+origin:human") |

Unused: `acceptEdits` (auto-approves file edits more loosely than workspace — assigned to no profile, with the risk of bypassing approval gates), `auto` (a mode that defers to runtime default judgment, so it does not map deterministically to any of the three profiles), `dontAsk` (overlaps trusted, but its semantics are less clear than bypassPermissions, so it is excluded).

## Version drift check (2026-09-20)

`claude --version` → `2.1.274 (Claude Code)` — identical to the version confirmed by `_probes/2026-09-20-cli-probes.md`. The 6 values in the output of `claude --help 2>&1 | grep -A2 "permission-mode"` (`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) match in both order and string, and the absence of a `"default"` value is reconfirmed. No drift.
