# omnis

**Everything is an inbox.** One real-time inbox for every channel and every agent, with your context.

> Status: planning complete, Phase 0 (spikes) starting. Private until launch. The full 기획서 lives in [`docs/spec/00-omnis-design.md`](docs/spec/00-omnis-design.md); research provenance in [`docs/research/`](docs/research/).

Three theses drive every decision:

1. **Everything is an inbox.** A message from a person and a turn from an agent land in the same queue.
2. **Context is the product.** The inbox is the surface; the asset is one unified memory about you.
3. **Agents act first, you decide.** Drafts, labels, tasks and delegation proposals are ready before you look. Anything that leaves the system passes your approval.

Channels (v1): Slack, Gmail, Outlook, Google Calendar, Telegram, WhatsApp, KakaoTalk, LinkedIn. Agent runtimes: omnis, Claude Code, Codex, DeepSeek (claude-ds), Hermes.

Topology now: a Mac mini hub over Tailscale, a macOS app (Tauri 2) and an iPhone client (PWA → native). Later: standalone on a MacBook + iPhone.

The launch README with demos and architecture visuals is planned in `docs/spec/A8-readme-blueprint.md`.

### Zero 동기화 (Phase A)

`ops/zero-cache.env.example`을 복사해 값을 채우고 `pnpm dlx @rocicorp/zero@1.9.0 zero-cache --env-file ops/zero-cache.env`로 띄운다. 허브는 부팅 시 `zero_omnis` publication이 `packages/kernel/src/zero-schema.ts`와 일치하는지 검사하고, 어긋나면 기동을 거부한다.
