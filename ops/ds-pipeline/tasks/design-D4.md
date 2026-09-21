# D4: Motion pass

Worktree: /Users/logankim/AI-Workspaces/omnis.plan-design-w1 (branch plan/design-w1). Per-branch DB: omnis_test_design_w1. Desktop dev server: `pnpm --filter @omnis/desktop dev` (Vite 5173). For realistic screens use the e2e seed: read tools/e2e/run.ts / tools/e2e/seed.ts / tools/e2e/shots.ts and reuse them (they boot hub + zero-cache + seed omnis_e2e). Playwright is installed (tools/e2e). Project skills live in .claude/skills (hallmark, motion-dev-animations, design-tokens, tailwind-v4-shadcn) and load via the Skill tool. Screenshots go under docs/design/screens/ and are committed.

Hard rules: glass only on rail/toolbar/sheet/palette/floating panels; lists/body opaque; light theme; no new heavy dependencies without checking package.json; never hand-draw brand SVGs; reduced-motion respected; nothing overflows horizontally at 390/768/1024/1440.

## Brief
Load Skill(motion-dev-animations) and Skill(apple-design). Add spring motion (motion library if it is already a dependency; otherwise CSS transitions with spring-like cubic-bezier — do NOT add a new heavy dependency without checking package.json first) to: row selection (elevation 160ms), archive row leave (collapse + fade 240ms), panel/sheet open (320ms), pill state change (160ms), tab switch. Respect prefers-reduced-motion everywhere (instant or 80ms fades). Tests: reduced-motion media query honored (RTL with matchMedia mock); a short Playwright video or 3 sequential screenshots documenting one transition into docs/design/screens/motion/. Commit "US-D04: spring motion pass with reduced-motion".

## Acceptance (the reviewer will check all of these)
- Every item of the brief implemented; tests named in the brief exist and pass; `pnpm lint && pnpm typecheck` clean; the named screenshots committed and, when Read next to the reference images, actually read as the reference.
- Commit messages as the brief says, with the trailers.
