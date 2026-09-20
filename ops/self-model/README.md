# self-model repo (`~/.omnis/self-model/`)

Three files and that is all: USER.md, VOICE.md, PROJECTS.md. They go verbatim into the cache prefix of every T1/T2 call (A4 §1.3).

| Item | Value |
|---|---|
| Path | `~/.omnis/self-model/` (overridden by `OMNIS_SELF_MODEL_DIR`) |
| Version control | One local git repo. No remote — this content never leaves the mini |
| Token caps | USER.md 1,200 · VOICE.md 1,500 · PROJECTS.md 1,500 (A4 §12.3) |
| Who writes it | Humans edit it directly. Agents only go through `propose_self_model_patch` → approval → `applySelfModelPatch()` (A4 §13.3) |
| Backup | `~/.omnis/` is already included in the restic target (A6 §4) |

## Initialization

The hub calls `ensureSelfModelRepo()` at boot, so there is usually nothing to do. If a cap is exceeded, the Sunday 21:00 job (`self_model_weekly`, US-B25) proposes a patch to "demote these items to memories."

## Reverting

    git -C ~/.omnis/self-model log --oneline     # patch history
    git -C ~/.omnis/self-model revert <sha>      # after reverting, restart the hub and the cache is cleared
