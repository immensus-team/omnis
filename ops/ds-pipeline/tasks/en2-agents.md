# English sweep 2 — shard en2-agents

Worktree: /Users/logankim/AI-Workspaces/omnis.plan-en2-agents (branch plan/en2-agents). Per-branch DB: omnis_test_en2_agents. Scope (only these paths): packages/agents packages/memory


Procedure: list targets with `LC_ALL=en_US.UTF-8 git ls-files <paths> | grep -v /dist/ | xargs grep -l '[가-힣]'`. For EACH file translate every Korean comment, string literal, test name/description, log message and doc line into natural, precise technical English — logic, identifiers, and behavior unchanged; do not reformat unrelated lines. Exceptions: (a) Korean that is itself the subject of a test, regex, fixture or scanner pattern stays, with an English gloss comment; (b) keep it out of UI copy — if a UI string is Korean, translate it (the product ships English UI). Work in batches of 3–6 files and commit after each batch (`i18n(en): <shard> batch N`). After all files: `LC_ALL=en_US.UTF-8 git ls-files <paths> | grep -v /dist/ | xargs grep -o '[가-힣]' | wc -l` should be 0 except glossed exceptions (list them in the summary). Run `pnpm lint && pnpm typecheck` and the affected packages' tests on the per-branch DB (`createdb` + `db:migrate` first); everything must pass.

Acceptance: no Korean left in scope except glossed exceptions; no behavior/logic change (diff vs main touches only comments/strings/test names/docs); lint/typecheck/tests green; trailers on every commit; tree clean.
