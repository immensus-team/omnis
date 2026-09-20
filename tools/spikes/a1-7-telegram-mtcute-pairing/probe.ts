// A1-⑦: mtcute QR 페어링이 문서대로 동작하는지, TelegramClientLike가 실제 TelegramClient로
// 구조적으로 만족되는지 확인한다. 실행: OMNIS_TELEGRAM_API_ID/HASH를 export하고
// tsx tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts
const apiId = process.env.OMNIS_TELEGRAM_API_ID;
const apiHash = process.env.OMNIS_TELEGRAM_API_HASH;
if (!apiId || !apiHash) {
  console.error("OMNIS_TELEGRAM_API_ID/HASH not set — B-D5: 실계정 연결 전에는 이 스파이크를 돌리지 않는다.");
  process.exit(1);
}
const { TelegramClient } = await import("@mtcute/node");
const client = new TelegramClient({ apiId: Number(apiId), apiHash, storage: "spike-session" });
await client.start({ qrCallback: (url: string) => console.log("scan:", url) });
console.log("paired as", await client.getMe());
