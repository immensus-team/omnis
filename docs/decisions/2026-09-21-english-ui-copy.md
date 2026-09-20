# Decision — Default UI copy is English

Date: 2026-09-21. Status: accepted.

## Context

The repo rule (`CLAUDE.md`) is that everything in this repository is English — docs, comments,
identifiers, UI copy, commit messages. The spec (`docs/spec/A5-ui-ux.md`) predates that rule and
was written in Korean, including its product copy.

## Decision

The product's default UI copy is English.

This went beyond translating the spec, so it is recorded here rather than left implicit in the
`i18n(en): translate ...` commits:

- **A5 §8 (microcopy table)** read "the default is Korean" with a Korean copy column. It now reads
  "The default copy is English", and every user-facing string in the table was replaced with its
  English equivalent. The second column remains the exact string used in code / aria-labels.
- **A5 §9 (QA checklist)** had a section titled "Korean UI" whose checkbox asked "is user-facing
  text in Korean?". It is now "Copy and register", and the rule was rewritten to check register
  consistency and that technical terms stay confined to code/aria-labels.
- **A5 review notes**: the older entry that "corrected" the `"Draft: {first part of body}"` preview
  prefix into Korean is explicitly superseded; the English prefix in §3.1 is the current state.

## What is *not* affected

Language of **runtime content** is a separate axis and stays as specified:

- `A4 §11.2` prompt-injection scanners keep their Korean regex alternations — they match inbound
  user data (KakaoTalk, Korean Slack/Gmail per A1), not repo prose.
- `A4 §1.2` `rationale` and `A4 §3.2` `register` are generated per run and follow the language of
  the user's own content.
- `A5 §4` typography keeps the Pretendard (Korean) + Inter (Latin) chain: the user reads Korean
  inbound mail regardless of the shell's copy language.
