# Gate ⑫: `--permission-mode` ↔ permission profile mapping

- **Question**: Can every allowed value of `--permission-mode` be definitively mapped to the 3 permission profiles in A2 §7.1 (`observe`/`workspace`/`trusted`)?
- **Owning appendix**: A2 §7.1 (S-A2-2)
- **Owner**: agent(unattended)
- **Host**: macbook
- **Run date**: 2026-09-20
- **Result (Pass/Fail)**: Pass — 3 profiles confirmed
- **Measurements/Evidence**: `claude --version` → `2.1.274 (Claude Code)`; both the version and all 6 values match `_probes/2026-09-20-cli-probes.md` (no drift). See `tools/spikes/gate-12-permission-mode-mapping/mapping.md` for the confirmed mapping table: `observe`→`plan`, `workspace`→`manual`, `trusted`→`bypassPermissions`. The 3 unused values (`acceptEdits`/`auto`/`dontAsk`) are excluded with rationale.
- **decided_by**: agent(Sonnet, gate-12 spike)
- **Notes**: Confirmed identically to the pending mapping in contract `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §8/§3.5 — the contract file itself is out of scope for this plan, so it was not modified (flagged only, in case a separate update is needed).
