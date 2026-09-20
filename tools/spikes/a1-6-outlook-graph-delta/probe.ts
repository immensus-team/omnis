// A1-⑥: Verify against a real account that the Graph delta query (/me/mailFolders/inbox/messages/delta) behaves as documented.
// Run: OMNIS_OUTLOOK_ACCESS_TOKEN=<token> tsx tools/spikes/a1-6-outlook-graph-delta/probe.ts
const token = process.env.OMNIS_OUTLOOK_ACCESS_TOKEN;
if (!token) {
  console.error("OMNIS_OUTLOOK_ACCESS_TOKEN not set — B-D5: do not run this spike before connecting a real account.");
  process.exit(1);
}
const res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", {
  headers: { authorization: `Bearer ${token}` },
});
console.log(res.status, JSON.stringify(await res.json(), null, 2).slice(0, 2000));
