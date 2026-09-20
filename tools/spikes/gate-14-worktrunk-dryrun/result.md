# Gate ⑭: worktrunk 드라이런

- **질문**: `worktrunk`로 워크트리 create/remove 왕복이 실제로 되는가(정확한 서브커맨드·플래그는 A7-D5가 UNVERIFIED로 남긴 것).
- **소유 부록**: A7 (§3 "worktrunk 워크트리 격리 절차")
- **Owner**: agent(unattended)
- **Host**: macbook
- **실행일**: 2026-09-20 (최초 측정: `tools/spikes/_probes/2026-09-20-cli-probes.md` "Gate ⑦(schema)와 ⑭ evidence"; 본 태스크에서 `tools/spikes/gate-14-worktrunk-dryrun/run.sh`로 스크래치 레포에 대고 재확인, `run.log` 참조)
- **결과(Pass/Fail)**: **PASS** — `create_pass=true`, `remove_pass=true`
- **측정치/근거**:
  - 바이너리는 `worktrunk`가 아니라 `wt`(brew formula 이름은 worktrunk, 실행 파일명은 `wt`). PATH에 `worktrunk`는 없음(`which worktrunk` → not found), `which wt` → `/opt/homebrew/bin/wt`.
  - **create**: `wt switch --create <branch> -y --no-cd` (A7-D5 가정 `worktrunk create <branch>`는 서브커맨드명이 다름 — 정답은 `switch --create`, 축약 플래그 `-c`).
  - **remove**: `wt remove <branch> -y` (A7-D5 가정 `worktrunk remove <story-id>`는 스토리 ID가 아니라 브랜치명을 받는다는 점만 빼면 형태는 맞음).
  - 워크트리 생성 위치는 `.worktrees/<story-id>`가 **아니라** worktrunk 기본 형제(sibling) 레이아웃 `<repo-dir>.<branch-with-/-as-->` (예: 레포 `omnis` + 브랜치 `spike/wt-dryrun` → `omnis.spike-wt-dryrun`; 본 태스크의 스크래치 레포 `tmp.NonKOfblxr` + 브랜치 `spike/gate-14-dryrun` → `tmp.NonKOfblxr.spike-gate-14-dryrun`, `run.log`에 grep 가능). 이미 `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §"브랜치·커밋"에 이 결론이 반영되어 있음: "워크트리는 worktrunk 기본 형제 레이아웃 `~/AI-Workspaces/omnis.<branch>`(게이트 ⑭ 실측, `tools/spikes/_probes`)".
  - `wt remove`는 "in background"로 비동기 처리한다고 로그에 찍히지만(`◎ Removing ... worktree & branch in background`), 후속 `test ! -d`가 바로 통과했다 — 스크립트 레벨에서는 문제 없이 관측됨(대형 워크트리·느린 디스크에서 레이스가 날 수 있으면 `--foreground` 플래그로 블로킹 전환 가능, A7 §3 절차 문서화 시 참고).
  - `run.sh`/`run.log`는 스크래치 레포(`mktemp -d`)에서만 동작하며 실제 omnis 레포나 브랜치를 건드리지 않는다.
- **decided_by**: Fable(에이전트), 이전 측정은 2026-09-20 프로브 세션
- **비고**: A7-D5의 폴백 규칙("fail → 순수 `git worktree add`/`remove`로 낮춘다")은 발동하지 않는다 — PASS. A7 §3 본문의 `worktrunk create <branch>` / `worktrunk remove <story-id>` / `.worktrees/<story-id>` 서술은 위 실측과 어긋나므로(바이너리명 `wt`, 서브커맨드 `switch --create`/`remove`, 경로는 형제 레이아웃) 갱신이 필요하다는 점을 기록해 둔다 — 이 플랜은 A7 본문을 직접 고치지 않는다(플랜 헤더 명시 제약); 계약 문서(`phase-a-interfaces.md`)는 이미 형제 레이아웃으로 갱신되어 있다.
