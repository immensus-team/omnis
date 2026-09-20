# self-model 레포 (`~/.omnis/self-model/`)

USER.md · VOICE.md · PROJECTS.md 세 파일이 전부다. 모든 T1/T2 호출의 캐시 프리픽스에 그대로 들어간다(A4 §1.3).

| 항목 | 값 |
|---|---|
| 경로 | `~/.omnis/self-model/` (`OMNIS_SELF_MODEL_DIR`로 덮어쓴다) |
| 버전 관리 | 로컬 git 레포 1개. 원격 없음 — 이 내용은 미니 밖으로 나가지 않는다 |
| 토큰 상한 | USER.md 1,200 · VOICE.md 1,500 · PROJECTS.md 1,500 (A4 §12.3) |
| 누가 쓰나 | 사람은 직접 편집한다. 에이전트는 `propose_self_model_patch` → 승인 → `applySelfModelPatch()`만 (A4 §13.3) |
| 백업 | restic 대상에 `~/.omnis/`가 이미 포함된다 (A6 §4) |

## 초기화

허브가 부팅 때 `ensureSelfModelRepo()`를 부르므로 보통은 할 게 없다. 상한을 넘으면 일요일 21:00 잡(`self_model_weekly`, US-B25)이 "이 항목들을 memories로 내리자"는 패치를 제안한다.

## 되돌리기

    git -C ~/.omnis/self-model log --oneline     # 패치 히스토리
    git -C ~/.omnis/self-model revert <sha>      # 되돌린 뒤 허브를 재기동하면 캐시가 비워진다
