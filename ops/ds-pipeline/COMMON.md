# omnis — common rules for every DeepSeek task (read fully before acting)

Environment: MacBook; Homebrew in /opt/homebrew/bin — ALWAYS prefix commands with `export PATH=/opt/homebrew/bin:$PATH &&`; Node 22+ and pnpm 9; local Postgres 17 (PGUSER=logankim, no password). NEVER run tests against omnis_dev or omnis_test — use the per-branch DB named in the task (`createdb <db>` if missing, then `DATABASE_URL=postgres://logankim@127.0.0.1:5432/<db> pnpm db:migrate`). Ollama at 127.0.0.1:11434 (nomic-embed-text). Other worktrees under ~/AI-Workspaces/omnis.plan-* belong to other tasks — never touch them, never kill other processes; ports 5173/8787/4848 may be busy, use alternates if the scripts allow, otherwise wait and retry.

Rules (repo CLAUDE.md applies):
- ENGLISH ONLY: UI copy, identifiers, comments, test names, docs, commit messages. Fix Korean strings in any file you touch.
- Design authority for UI: docs/design/DESIGN-DIRECTION.md, docs/design/SKILLS.md (preamble + 12-line anti-slop checklist), docs/design/reference/*.webp, docs/design/ACCENT-DIRECTION.md when present. Reuse packages/ui components (StatusPill, GroupHeader, FilterChipBar, KeyValueTable, ChannelGlyph, GlassSurface, AuroraSurface) instead of inventing new ones. Glass only on chrome (rail/toolbar/sheet/palette/floating panels); lists/body opaque; reduced-motion respected; no horizontal overflow at any width.
- TDD; real tests; never skip or delete tests; `pnpm lint && pnpm typecheck` and the relevant tests must pass before each commit.
- Work in small slices and COMMIT after each slice (message `<story>: <slice>`), so an interrupted run loses little. Commit trailers, in ONE block at the end of the message, no blank line between them:
  Implemented-by: DeepSeek V4.1 Flash
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
- Never print or commit secrets. Never push — the merge task pushes. Never `rm -rf`; move files instead.
- Never touch the Mac mini's Hermes/omh/buzz setup or port 8642.
- Start every task with `git status` and `git log --oneline -5`: a previous interrupted run may have left uncommitted edits — run lint/typecheck/tests on them, keep what compiles and fits the task, commit them, then continue. Do not discard committed work.
- Finish the WHOLE task list before returning. When done, print a final summary: HEAD sha, files changed, verify commands with pass/fail, deviations.
