# worktrunk 확정 사용법 (A7-D5, gate-14 dry-run 근거)

- 바이너리명: `wt`(brew formula 이름은 `worktrunk`이지만 PATH에 설치되는 실행 파일은 `wt`). `which worktrunk` → not found, `which wt` → `/opt/homebrew/bin/wt`.
- 워크트리 생성: `wt switch --create <branch> -y --no-cd` → 워크트리는 `.worktrees/<story-id>`가 아니라 worktrunk 기본 형제(sibling) 레이아웃 `<repo-dir>.<branch-with-/-as-->`(예: 레포 `omnis` + 브랜치 `ralph/<story-id>` → `omnis.ralph-<story-id>`)에 생성됨(gate-14 확인).
- 워크트리 제거: `wt remove <branch> -y`(스토리 ID가 아니라 브랜치명을 받는다). 백그라운드로 비동기 제거되지만 후속 `test ! -d`는 곧바로 통과했다(레이스가 우려되면 `--foreground`로 블로킹 전환 가능).
- ralph 루프(A7 §3)의 "스토리 착수 직전" 단계는 이 두 명령을 그대로 쓴다. A7-D5의 "UNVERIFIED — 스파이크" 표기는 이 문서로 해소된다.
- A7-D5 폴백 규칙("fail → 순수 `git worktree add`/`remove`")은 발동하지 않는다 — gate-14 PASS.
- 재현 증거: `tools/spikes/gate-14-worktrunk-dryrun/result.md`, `run.log`.
