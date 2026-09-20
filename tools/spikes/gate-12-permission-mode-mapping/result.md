# Gate ⑫: `--permission-mode` ↔ permission profile 매핑

- **질문**: `--permission-mode`의 실제 허용값 전수를 A2 §7.1의 3개 permission profile(`observe`/`workspace`/`trusted`)에 확정 매핑할 수 있는가.
- **소유 부록**: A2 §7.1 (S-A2-2)
- **Owner**: agent(unattended)
- **Host**: macbook
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: Pass — 3 profile 확정
- **측정치/근거**: `claude --version` → `2.1.274 (Claude Code)`, `_probes/2026-09-20-cli-probes.md`의 6개 값과 버전·값 모두 일치(드리프트 없음). 확정 매핑표는 `tools/spikes/gate-12-permission-mode-mapping/mapping.md` 참조: `observe`→`plan`, `workspace`→`manual`, `trusted`→`bypassPermissions`. 미사용 3개(`acceptEdits`/`auto`/`dontAsk`)는 근거와 함께 배제.
- **decided_by**: agent(Sonnet, gate-12 spike)
- **비고**: 계약 `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §8/§3.5의 pending 매핑과 동일하게 확정됨 — 계약 파일 자체는 이 플랜 범위 밖이라 수정하지 않음(별도 갱신 필요 시 표시만).
