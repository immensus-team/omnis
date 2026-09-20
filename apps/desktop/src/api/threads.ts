// 쓰기는 전부 허브 HTTP를 거친다(계약 §5) — Zero는 읽기 전용이다.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** US-A36 수동 보관/되살리기. 성공하면 허브가 threads.archived_at을 바꾸고 Zero가 그걸 밀어 준다. */
export async function setThreadArchived(id: string, archived: boolean): Promise<void> {
  const verb = archived ? "archive" : "unarchive";
  const res = await fetch(`${HUB_HTTP_URL}/api/threads/${id}/${verb}`, { method: "POST" });
  if (!res.ok) throw new Error(`thread ${verb} failed: HTTP ${res.status}`);
}
