# omnis — rules for every agent working in this repo

## Language: English only
Everything in this repository is written in English: UI copy, identifiers, comments, test names and descriptions, fixtures, docs, README, commit messages, PR text.
- No Korean (or any non-English) strings in `apps/`, `packages/`, `tools/`, `ops/`, `eval/`, `docs/`.
- If an i18n layer exists, `en` is the source locale and must be complete; other locales are optional add-ons, never the source of truth.
- Reviewers reject changes that add non-English text.
- One exception: translated READMEs at the repo root (`README.<lang>.md`, linked from the LANG badges). They are deliberate and must stay in sync with `README.md`.
- Fixture/seed data that imitates real messages may quote non-English content only when the test is specifically about non-English input; label it as such.

## Design
Follow `docs/design/DESIGN-DIRECTION.md` (kinso-style light UI, glassy, no AI-slop) and the mandatory preamble/checklist in `docs/design/SKILLS.md` before touching UI.

## Engineering
- Run `pnpm lint && pnpm typecheck` before committing; tests need a per-branch DB (`omnis_test_<slug>`), never the shared `omnis_test`.
- `packages/db/migrations/*.sql` are **frozen once applied**: `packages/db/src/migrate.ts` hashes each file's bytes and refuses to run when an applied file changed, so editing one breaks `pnpm db:migrate` in every environment that already applied it — the mini's production DB included. Migrations `0001`–`0013` are applied everywhere, so their original comments stay as they are and the English-only rule does not apply to them. Add a new migration instead of editing one.
- New packages go into the root `tsconfig.json` references.
- Never touch the Mac mini's Hermes/omh/buzz setup or port 8642.
