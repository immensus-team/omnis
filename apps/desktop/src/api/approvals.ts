// OMNIS_HUB_HTTP_URL: 인터페이스 계약 §9 환경변수 목록에 등재된 변수(계약 리뷰 M11) — 빌드 시 미설정이면 로컬 기본값으로 fallback.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

export async function decideApproval(
  id: string,
  decision: "accept" | "edit" | "respond" | "ignore",
  decidedArgs?: Record<string, unknown>,
): Promise<{ id: string; state: "decided" }> {
  const res = await fetch(`${HUB_HTTP_URL}/approvals/${id}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, decided_args: decidedArgs }),
  });
  if (!res.ok) throw new Error(`approval decide failed: HTTP ${res.status}`);
  return res.json();
}
