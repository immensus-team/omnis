# Gate ⑪: `claude -p --bare` hook 주입

- **질문**: `-p --bare` 조합에서 `--settings`로 omnis 자체 hook 설정을 명시 주입했을 때, `PreToolUse` hook이 실제로 발동해 승인 게이트로 이어지는가 — 그리고 그때 대상 레포 자신의 `.claude/settings.json` project hook은 안 뜨는가.
- **소유 부록**: A2(§4.1, §8.3, S-A2-1)
- **Owner**: agent (unattended)
- **Host**: macbook (Claude Code 2.1.274)
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: **FAIL** (두 모드 모두 pass 조건 `omnis_hook_fired=true AND project_hook_fired=false`를 못 채움) → Fail 결정 규칙 적용(아래 참조)
- **측정치/근거** (`./run.sh` 독립 2회 — 매 런 로그를 새로 만들므로 두 번째도 진짜 재측정이다, 아래 편차 4 참조 — 결과 동일):
    ```
    mode_a_omnis_hook_fired=false
    mode_a_project_hook_fired=false
    mode_b_omnis_hook_fired=true
    mode_b_project_hook_fired=true
    ```
  - **mode (a)** (`--bare --settings out/hooks-settings.json --permission-mode manual`, driver=`claude-ds`, cwd=fresh fixture worktree with its own `.claude/settings.json` PreToolUse hook): 인증되어 **툴 단계까지 정상 도달·완주**했다 — `[Stall] tool_dispatch_start tool=Bash … permissionDecisionMs=3` → `tool_dispatch_end … outcome=ok`, CLI stdout에 `GATE11_PROBE_MARKER`(`evidence/mode-a-2026-09-20.txt`). 그런데 `--debug hooks` 로그에 `Hook PreToolUse` 줄이 **0건** — `GATE11_HOOK_FIRED`도 `PROJECT_HOOK_FIRED`도 없다. 즉 **`--bare`는 `--settings` 안에 선언된 hook을 아예 무시한다**. `_probes/2026-09-20-cli-probes.md` 전제 1번이 UNVERIFIED로 남기고 게이트 ⑪의 핵심 질문으로 지목한 문장("Whether hooks declared inside a `--settings` file are honored under `--bare` is UNVERIFIED")에 대한 답은 **NO**다(untested가 아니라 측정된 false).
    - 부수 관측(같은 런): **`--permission-mode manual`도 `--bare` 아래에서는 무시되는 것으로 보인다** — `permissionDecisionMs=3`에 승인 프롬프트 없이 `outcome=ok`. 승인 표면 자체가 `--bare`에서 꺼진다는 방증이라 게이트 ⑫(A2 §7.1 매핑)에도 걸린다.
  - **mode (b)** (non-bare `--settings out/hooks-settings.json --permission-mode manual`, cwd=같은 fixture worktree): 프롬프트가 실제로 Bash tool_use를 발생시켰고(`echo GATE11_PROBE_MARKER`), `--debug hooks` 로그의 결정적 2줄(`evidence/mode-b-2026-09-20.txt`, 이 런의 로그에서 각각 정확히 1회):
    ```
    Hook PreToolUse:Bash (PreToolUse) error:\nGATE11_HOOK_FIRED tool=Bash
    Hook PreToolUse:Bash (PreToolUse) success:\nPROJECT_HOOK_FIRED tool=Bash
    ```
    omnis hook(`--settings`로 주입, exit 2)이 실제로 발동해 Bash 호출을 막았다 — **non-bare에서는 "`--settings`로 hook을 주입하는 플래그 표면"이 작동한다(TRUE)**. 그러나 같은 호출에서 fixture의 **project 자체 `.claude/settings.json` PreToolUse hook도 함께 발동**했다(exit 0, 승인) — `--settings`는 project hook을 **대체(replace)하지 않고 병합(additive)**한다. 격리가 안 되므로 pass 조건(project hook은 안 뜬다)을 못 채운다.
  - **판정기 설계 근거**: 평문 CLI 출력(`out/mode-{a,b}.log`)은 모델이 hook 차단 사유를 자기 말로 요약해 전달할 뿐이라 신뢰할 수 없다(관측: 모델이 `"run: ls"` 프롬프트에서는 아예 Bash tool을 호출하지 않고 세션 초기 컨텍스트에서 답을 지어내기도 했다). `run.sh`는 `--debug hooks --debug-file`의 raw hook stdout/stderr를 직접 파싱해 판정하며, 그 로그는 매 런 새로 만든다(편차 4).
- **decided_by**: agent(Fable), 2026-09-20 — FAIL 확정. **§19 Q13 반영 대상으로 기록**(이 플랜은 마스터 문서를 고치지 않음 — 실제 §19 갱신은 Phase A 착수 전 Logan 확인 항목).
- **비고**:
  - **Fail 결정 규칙 적용(A2 §4.1 대안 경로, plan Task 5 원문)**: delegated 런에서 `PreToolUse` 기반 승인 승격 경로를 포기하고, 브리지가 각 `tool_use` 이벤트를 직접 가로채 승인으로 승격하는 폴링 방식으로 낮춘다. 근거는 모드별로 다르다:
    - `--bare` 런(mode a)에서는 hook 표면이 **존재하지 않는다** — `--settings`의 hook 선언이 무시되므로 폴링 말고는 승인 경로가 없다. 이는 선호가 아니라 **강제**다: `phase-a-interfaces.md` §8은 `claude_ds` 런타임의 `bare` 기본값을 `true`로 두므로, **`claude_ds`에는 폴링 폴백이 필수**다.
    - non-bare 런(mode b)에서는 hook이 뜨지만 project hook과 **격리되지 않는다**(병합). project repo가 자체 `.claude/settings.json`을 갖고 있으면 그 hook도 함께 실행되어 omnis가 유일한 승인 경로임을 보장할 수 없다.
  - **A2-D11 충돌(그대로 옮겨 적음, `_probes/2026-09-20-cli-probes.md` "Findings that change gate ⑪" 2번)**: "Under `--bare`, Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`; OAuth and Keychain are never read." 이번 실행이 재확인했다 — 구독 로그인 상태의 `claude`로 `--bare`를 돌리면 `Not logged in · Please run /login`으로 즉시 종료했고, API 키가 export된 래퍼(`claude-ds`)로 바꾸자 동일 명령이 그대로 완주했다. A2-D11은 "delegated 런은 구독 바이너리를 그대로 탄다"고 가정하는데 `--bare`에서는 그 가정이 깨진다 — **A2-D11 재검토는 이 플랜의 범위 밖, Phase A 착수 전 Logan 에스컬레이션 항목**으로 남긴다.
  - **편차 1(경로 버그, 최소 수정)**: 계획서 5번 단계가 준 `hooks-settings.json`은 `"command": "node tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs"`(cwd 상대경로)라, Claude Code의 cwd가 fixture worktree인 런에서는 `Error: Cannot find module …`로 **omnis hook 자체가 죽어** false negative를 낸다(`claude --debug hooks`로 근본원인 확인). 추적 파일 `hooks-settings.json`은 계획서 원문 그대로 남기되 파일 안 `"$comment"`에 "illustrative only"임을 명시했고, `run.sh`가 실행 시점에 절대경로 버전을 `out/hooks-settings.json`으로 생성해 그쪽을 `--settings`로 넘긴다.
  - **편차 2(프롬프트 신뢰성)**: 계획서 원문 프롬프트 `"run: ls"`는 모델이 Bash tool을 아예 호출하지 않고 답을 지어내는 경우가 있어 hook 발동 여부를 시험하지 못했다. "반드시 Bash tool을 호출하라"는 지시형 프롬프트로 바꾸고, `$`/백틱이 든 명령은 이 hook과 무관한 별도 내장 가드("Contains simple_expansion")에 걸리므로 순수 리터럴 `echo GATE11_PROBE_MARKER`를 썼다.
  - **편차 3(판정 소스)**: 원 계획의 `check()`는 CLI 평문 로그를 grep했다. 모델이 hook 차단 사유를 재서술하며 마커를 누락·변형할 수 있어 신뢰할 수 없다. `--debug hooks --debug-file`의 raw hook stdout/stderr를 grep하는 쪽으로 바꿨다(우리 hook은 exit 2라 "(PreToolUse) error:", project hook은 exit 0이라 "(PreToolUse) success:"로 분류되지만 마커 텍스트는 그대로 남는다).
  - **편차 4(런 격리 — 판정기 정확성)**: `claude --debug-file`은 대상 파일에 **append**한다. 누적 파일을 grep하면 이전 런이 남긴 마커가 이번 런의 결과로 집계되어, 훗날 Claude Code가 격리를 고친 뒤 재실행해도 오늘 날짜의 stale 라인 때문에 계속 FAIL로 보고된다. `run.sh`는 이제 매 런 시작에 `out/`을 통째로 지우고 다시 만든 뒤 그 안에만 쓴다(디버그 로그, CLI 로그, 생성된 settings, Claude Code가 `--debug-file` 옆에 떨구는 `latest` 심링크까지). `out/`은 `.gitignore`의 `tools/spikes/**/out/`에 이미 걸려 있어 `./run.sh` 실행이 더 이상 워크트리를 더럽히지 않는다(실행 후 `git status --porcelain` 깨끗함 확인).
  - **편차 5(mode (a) 드라이버)**: `--bare`는 OAuth/Keychain을 안 읽으므로 구독 로그인만으로는 mode (a)를 측정할 수 없다. 이 맥북에는 `ANTHROPIC_API_KEY`가 export돼 있지 않지만 PATH의 `claude-ds`가 `ANTHROPIC_AUTH_TOKEN`을 Keychain에서 export한 뒤 `exec claude "$@"` 하는 래퍼 — 즉 mode (a)가 요구하는 "API 키로 인증된 Claude Code" 그 자체다. `run.sh`는 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`이 있으면 `claude`, 없으면 `claude-ds`를 드라이버로 고르고, 둘 다 없으면 `mode_a_skipped=true`를 찍는다. (모델은 `deepseek-flash`지만 게이트가 재는 것은 CLI의 hook/권한 표면이라 모델 선택과 무관하다.)
  - **편차 6(mode (a) cwd)**: 계획서는 mode (a)를 project fixture 없는 repo root에서 돌리는데, 그러면 `project_hook_fired=false`가 공허하게 참이 된다. pass 조건 두 항을 모두 실측하려고 mode (b)와 **같은 fixture worktree**에서 돌렸다.
  - 원문 raw 로그는 `.gitignore`의 `*.log`를 피해 `evidence/mode-{a,b}-2026-09-20.txt`로 보관(gate-07 관행과 동일).
