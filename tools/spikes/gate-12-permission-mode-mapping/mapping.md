# permission-mode ↔ profile 확정 매핑 (gate-12, S-A2-2)

| profile (A2 §7.1) | `--permission-mode` | 근거 |
|---|---|---|
| `observe` | `plan` | 파일 쓰기·도구 실행이 없는 읽기 전용 계획 모드. `inbox:*` 루프 전용(A2 §7.1) |
| `workspace` | `manual` | cwd 하위 파일 쓰기 + 그 외 도구는 승인 프롬프트(hook 경유, gate-11) |
| `trusted` | `bypassPermissions` | `origin:'human'`에서만, allowed_roots 내(A2 §7.1 "bypassPermissions는 trusted+origin:human에서만") |

미사용: `acceptEdits`(workspace보다 느슨하게 파일 편집을 자동 승인 — 어떤 profile에도 배정하지 않음, 승인 게이트 우회 소지), `auto`(런타임 기본 판단에 맡기는 모드라 세 profile 중 무엇에도 결정론적으로 대응 안 됨), `dontAsk`(trusted와 겹치나 bypassPermissions보다 의미가 불명확해 배제).

## 버전 드리프트 체크 (2026-09-20)

`claude --version` → `2.1.274 (Claude Code)` — `_probes/2026-09-20-cli-probes.md`가 확인한 버전과 동일. `claude --help 2>&1 | grep -A2 "permission-mode"` 출력의 6개 값(`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) 순서·문자열 모두 일치, `"default"` 값 없음도 재확인. 드리프트 없음.
