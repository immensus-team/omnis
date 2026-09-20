# Gate: A1-⑦ Telegram mtcute pairing

- **Question**: Does mtcute QR login pairing behave as documented, and does the real `TelegramClient`
  structurally satisfy this adapter's `TelegramClientLike` (start/getHistory/onUpdate/sendText/readHistory)?
- **Owning appendix**: A1 §2.5
- **Owner**: agent
- **Host**: mini
- **Run date**: PENDING — after B-D5 (real-account connections happen later, all at once; Logan 2026-09-20 decision)
- **Result (Pass/Fail)**: PENDING
- **Measurements/Evidence**: Fill this in by running `probe.ts` with a real `api_id`/`api_hash`. If method names differ,
  adjust `TelegramClientLike` to match the real API and record the diff in this result.md
- **decided_by**: PENDING
- **Notes**: The adapter implementation for this plan (US-B38) was already accepted against fixtures/mocks — this spike
  is for real-connection verification, not an implementation gate
