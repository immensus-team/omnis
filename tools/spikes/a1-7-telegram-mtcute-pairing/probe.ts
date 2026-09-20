// A1-⑦: Verify that mtcute QR pairing behaves as documented, and that TelegramClientLike is
// structurally satisfied by the real TelegramClient. Run: export OMNIS_TELEGRAM_API_ID/HASH and
// tsx tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts
const apiId = process.env.OMNIS_TELEGRAM_API_ID;
const apiHash = process.env.OMNIS_TELEGRAM_API_HASH;
if (!apiId || !apiHash) {
  console.error("OMNIS_TELEGRAM_API_ID/HASH not set — B-D5: do not run this spike before connecting a real account.");
  process.exit(1);
}
const { TelegramClient } = await import("@mtcute/node");
const client = new TelegramClient({ apiId: Number(apiId), apiHash, storage: "spike-session" });
await client.start({ qrCallback: (url: string) => console.log("scan:", url) });
console.log("paired as", await client.getMe());
