# Gate ⑪b: `--permission-prompt-tool` 헤드리스 승인 표면

- **질문**: delegated Claude Code 런에 `claude -p --permission-prompt-tool <mcp_tool>`로 헤드리스 승인 표면을 붙일 수 있는가 — MCP tool은 로컬 stdio MCP 서버(`@modelcontextprotocol/sdk` 1.30.0, TypeScript)로 서빙하고, 각 승인 요청을 파일에 로그로 남기고 규칙으로 allow/deny를 답한다(Bash deny, Read allow). (a) non-bare + 구독 인증, (b) `--bare` + claude-ds(API 키) 두 모드를 게이트 ⑪과 같은 probe 설계(project hook 있는 fixture worktree, Bash를 강제로 호출하는 프롬프트, MCP 서버 자체 로그 + `--debug` 출력으로만 판정)로 측정한다.
- **소유 부록**: A2(§4.1 spike S-A2-1b), §19 Q13(③)
- **Owner**: agent (unattended)
- **Host**: macbook (Claude Code 2.1.274)
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: **PASS** — 두 모드 모두 pass 조건(permission tool이 Bash 호출에 대해 invoke되고 그 deny가 지켜짐)을 채웠다. 게이트 ⑪(hook 기반, FAIL)보다 강한 결과 — `--permission-prompt-tool`은 `--bare`에서도 살아있다.
- **측정치/근거** (`./run.sh`, 아래 결과는 독립 3회 실행 — 매번 `out/`을 지우고 다시 만들므로 재실행마다 진짜 재측정 — 세 번 모두 동일):
    ```
    mode_a_permission_tool_invoked_for_bash=true
    mode_a_bash_denied=true
    mode_a_project_hook_fired=true
    mode_a_debug_shows_mcp_tool_call=true
    mode_a_latency_ms=10005            (전체 턴 wall-clock, 3회 범위 8.0–10.3s)

    mode_b_permission_tool_invoked_for_bash=true
    mode_b_bash_denied=true
    mode_b_project_hook_fired=false
    mode_b_debug_shows_mcp_tool_call=true
    mode_b_latency_ms=2965             (전체 턴 wall-clock, 3회 범위 2.5–3.6s)
    ```
  - **mode (a)** (non-bare, driver=`claude`, 구독 OAuth, cwd=fixture worktree with its own project hook): `--debug hooks,mcp,permissions --debug-file`가 결정적 3줄을 남긴다(`evidence/mode-a-debug-2026-09-20.txt`) —
    ```
    "Hook PreToolUse:Bash (PreToolUse) success:\nGATE11B_PROJECT_HOOK_FIRED tool=Bash"
    MCP server "omnis_gate11b": Calling MCP tool: approval_prompt
    MCP server "omnis_gate11b": Tool 'approval_prompt' completed successfully in 4ms
    ```
    우리 MCP 서버 자체 요청 로그(`evidence/mode-a-requests-2026-09-20.txt`, `GATE11B_LOG_PATH`로 지정한 파일 — 모델 stdout이 아니라 서버가 직접 쓴다)에 정확히 1줄: `{"tool_name":"Bash","input":{"command":"touch /tmp/gate11b_probe_marker.txt",...},"decision":"deny"}`. Bash는 실행되지 않았고 모델 stdout(`evidence/mode-a-stdout-2026-09-20.txt`)도 독립적으로 "denied by a permission rule … omnis gate-11b"라고 보고한다(판정에는 안 씀, 참고용).
    **project hook은 죽지 않는다**(게이트 ⑪ non-bare 결과와 동일한 격리 부재) — `.claude/settings.json`의 fixture project hook이 우리 permission-prompt-tool과 나란히 발동한다. 그러나 그 hook은 exit 0("success")일 뿐이라 "차단하지 않는다"는 뜻이지 승인 권한을 갖는 게 아니다(공식 문서 permission evaluation flow: hooks → deny rules → ask rules → permission mode → allow rules → `canUseTool`) — 실제로 우리 tool의 deny가 최종 결정을 뒤집지 못하게 막았다. 즉 **격리는 여전히 안 되지만(project hook이 계속 실행됨), 그 hook이 exit 0으로 열어놔도 canUseTool 단계에서 우리 규칙이 최종 승인권을 쥔다** — project hook이 자체적으로 exit 2로 먼저 막아버리는 경로(우리 tool에 도달하기 전에 project가 가로챌 가능성)는 이번 fixture에서는 안 일어났지만 이론상 남는 취약점이다(비고 참고).
  - **mode (b)** (`--bare`, driver=`claude-ds`, API 키 인증, 같은 fixture worktree): 같은 3줄이 뜨지만 hook 줄은 아예 없다(`evidence/mode-b-debug-2026-09-20.txt`에 `PreToolUse`/`GATE11B_PROJECT_HOOK_FIRED` 문자열 0건 — 게이트 ⑪이 확인한 "`--bare`는 hook을 전부 무시한다"와 정확히 일치) — 그런데 `--permission-prompt-tool`은 살아있다:
    ```
    MCP server "omnis_gate11b": Calling MCP tool: approval_prompt
    MCP server "omnis_gate11b": Tool 'approval_prompt' completed successfully in 4ms
    ```
    요청 로그(`evidence/mode-b-requests-2026-09-20.txt`) 1줄, `decision:"deny"`. **이것이 이 게이트의 핵심 신규 사실**: `--bare`는 `--settings`로 주입한 hook은 무시하지만(게이트 ⑪), `--mcp-config`로 등록하고 `--permission-prompt-tool`로 지정한 MCP tool은 무시하지 않는다 — `--bare`의 스킵 목록(`hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, CLAUDE.md auto-discovery`)에 MCP/permission-prompt-tool이 없다는 `claude --help` 문면과 실측이 일치한다.
  - **permission-prompt-tool 자체의 지연**: 두 모드 모두 서버가 요청을 받아 답하는 데 **3–4ms**(`--debug` 로그의 `Tool 'approval_prompt' completed successfully in Nms`) — 무시할 수 있는 수준. `latency_ms`로 찍은 8–10s(a) / 2.5–3.6s(b)는 **턴 전체**(모델 추론+스트리밍 포함) wall-clock이고 permission round-trip이 병목이 아니다. mode (a)가 mode (b)보다 느린 것은 구독 라우팅/모델 차이 때문으로 보이며 이 게이트가 재는 대상이 아니다.
  - **판정기 설계**: 게이트 ⑪과 동일 원칙 — 모델의 자연어 응답은 참고용일 뿐 판정에 쓰지 않는다. `run.sh`의 `check()`는 (1) 우리 MCP 서버가 직접 파일에 쓴 요청 로그(`GATE11B_LOG_PATH`)에서 `tool_name":"Bash"` 줄과 그 `decision` 필드를 grep하고, (2) `--debug hooks,mcp,permissions --debug-file`의 raw 출력에서 `Calling MCP tool: approval_prompt`(우리 tool이 실제로 호출됐다는 Claude Code 자신의 로그)와 project hook 마커를 grep한다.
- **decided_by**: agent(Fable), 2026-09-20 — PASS 확정. **§19 Q13(③) "헤드리스 승인 경로는 Wave 1 스파이크 S-A2-1b로 검증" 항목을 이 결과로 채운다**(마스터 문서 자체는 이 플랜에서 고치지 않음 — Logan 확인 후 §19/A2 §4.1의 UNVERIFIED 표시를 갱신하는 건 별도 작업).
  - **Q13 갱신 제안 문구(참고용, docs/spec 미수정)**: "헤드리스 승인 경로: `--permission-prompt-tool`로 브리지가 MCP tool을 서빙하면 non-bare(구독)·`--bare`(claude-ds, API 키) 양쪽 모두 Bash 호출에 대해 invoke되고 deny가 지켜진다(게이트 ⑪b PASS, 2026-09-20). `--bare` 위임 런(A2-D11이 요구하는 claude_ds 기본 경로)에서 hook 표면은 죽지만(게이트 ⑪) permission-prompt-tool 표면은 살아있다 — 따라서 브리지의 승인 승격 경로는 PreToolUse hook이 아니라 **`--permission-prompt-tool` + `--mcp-config`**로 통일해야 두 드라이버(구독 `claude`, `claude-ds`)에서 동일하게 동작한다. non-bare에서 project 자체 hook과의 격리는 여전히 안 되지만(project hook은 나란히 실행됨), permission evaluation 순서상 hook의 exit 0은 승인이 아니라 '차단 안 함'일 뿐이라 canUseTool 단계의 브리지 tool이 최종 결정권을 유지한다."
- **비고**:
  - **편차 1(probe 명령 교체, 게이트 ⑪ deviation 2의 후속)**: 계획대로 게이트 ⑪의 리터럴 프롬프트(`echo GATE11B_PROBE_MARKER`)를 그대로 썼더니 `mode_a_permission_tool_invoked_for_bash=false`가 재현됐다 — `--debug` 로그에 `tool_dispatch_start … permissionDecisionMs=2`(사실상 즉시 승인, MCP 호출 0건). 원인은 이 게이트가 재는 대상과 무관한 별개 사실: Claude Code는 `echo`류를 "읽기 전용 Bash 명령"으로 분류해 `canUseTool`/`--permission-prompt-tool` 이전 단계(허용 규칙)에서 자동 승인한다(공식 문서 "Allow rules" 단계: "a read-only Bash command"). `--permission-prompt-tool`이 실제로 불리는지 재려면 그 자동승인 목록에 없는 명령이 필요해서, 파일을 쓰는 `touch /tmp/gate11b_probe_marker.txt`로 바꿨다(여전히 `$`/백틱 없는 리터럴이라 게이트 ⑪ deviation 2의 가드는 그대로 피한다). 이 발견 자체는 permission-prompt-tool 게이트의 결과가 아니라 probe 설계 버그였음을 분명히 남긴다.
  - **편차 2(SDK 미채택 없음)**: `@modelcontextprotocol/sdk`가 npm에서 정상 설치됐다(pnpm registry 접근 가능) — plain JSON-RPC 폴백은 필요 없었다. 다만 SDK 1.30.0은 `zod` peer를 `^3.25 || ^4`로 요구해 원래 시도한 `zod@3.24.1`(SDK가 transitively 끌어온 버전)로는 `ERR_PACKAGE_PATH_NOT_EXPORTED`(zod의 `./v3` subpath export 누락)가 났다 — `package.json`에 `zod@3.25.76`을 직접 명시해 고쳤다. `tools/spikes/gate-11b-permission-prompt-tool/`은 게이트 06/13과 같은 패턴으로 자체 `package.json` + `pnpm-lock.yaml`(`pnpm install --ignore-workspace`, 루트 워크스페이스 글롭 밖)을 갖는다.
  - **편차 3(TypeScript 실행기)**: `tsx`를 새로 추가하지 않고 Node 26의 기본 TypeScript type-stripping(`node mcp-permission-server.ts`, 플래그 불필요)을 그대로 썼다 — 이 파일은 단순 타입 애너테이션만 쓰고 enum/namespace/decorator가 없어서 type-stripping만으로 충분하다.
  - **편차 4(런 격리)**: 게이트 ⑪ deviation 4와 동일한 이유로 `run.sh`는 매 실행 시작에 `out/`(gitignored, `tools/spikes/**/out/`)을 통째로 지우고 다시 만든다 — `--debug-file`이 append하고, 우리 MCP 서버의 요청 로그도 append하므로 그렇지 않으면 이전 런의 마커가 새 런의 판정에 섞인다. 실행 후 `git status --porcelain`은 새로 만든 `tools/spikes/gate-11b-permission-prompt-tool/`(신규 디렉터리) 외에는 깨끗함.
  - **편차 5(latency 측정)**: macOS BSD `date`는 `%N`(나노초)을 지원하지 않아 `date +%s%3N`이 그대로 정수로 오버플로했다 — `python3 -c 'import time; print(int(time.time()*1000))'`로 교체(이 맥에 python3 존재 확인됨).
  - **project hook 미격리의 잔여 위험(측정 범위 밖, 기록만)**: mode (a)에서 project 자체 hook이 exit 2로 먼저 차단해버리면 우리 permission-prompt-tool에 요청이 아예 도달하지 않는 경로가 이론상 있다(hooks가 평가 순서상 가장 먼저다) — 이번 fixture hook은 exit 0(allow)이라 이 경로를 시험하지 못했다. Logan 소유가 아닌 레포에 non-bare로 위임하면 그 레포의 project hook이 브리지 승인 경로보다 먼저 개입할 수 있다는 뜻이므로, §19 Q13①의 "Logan 소유 레포 allowlist에서만" 제약과 함께 읽어야 한다.
  - 원문 raw 로그는 `.gitignore`의 `*.log`를 피해 `evidence/{run-summary,mode-a-debug,mode-a-requests,mode-a-stdout,mode-b-debug,mode-b-requests,mode-b-stdout}-2026-09-20.txt`로 보관(게이트 ⑪ 관행과 동일). secrets 스캔(`authorization:|bearer |sk-ant|sk-proj|api[_-]?key`) 결과 0건.
