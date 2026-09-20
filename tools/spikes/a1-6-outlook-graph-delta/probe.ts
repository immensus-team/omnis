// A1-⑥: Graph delta query(/me/mailFolders/inbox/messages/delta)가 문서대로 동작하는지 실계정으로 확인한다.
// 실행: OMNIS_OUTLOOK_ACCESS_TOKEN=<token> tsx tools/spikes/a1-6-outlook-graph-delta/probe.ts
const token = process.env.OMNIS_OUTLOOK_ACCESS_TOKEN;
if (!token) {
  console.error("OMNIS_OUTLOOK_ACCESS_TOKEN not set — B-D5: 실계정 연결 전에는 이 스파이크를 돌리지 않는다.");
  process.exit(1);
}
const res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", {
  headers: { authorization: `Bearer ${token}` },
});
console.log(res.status, JSON.stringify(await res.json(), null, 2).slice(0, 2000));
