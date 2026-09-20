/** kinso 행 스펙(A5 §3.1, DESIGN-DIRECTION.md U2)의 회색 상대시간: "3m"/"5m"/"2w"/"4 Aug".
 * `now`는 테스트에서 고정 기준시를 주입하기 위한 파라미터(기본값 Date.now()). */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
// ponytail: 4주 이후는 요일 카운트 대신 날짜로 전환한다(카카오톡/Gmail류 관행) — 정확한 컷오프는
// 취향 문제라 임의 상수 하나로 고정, 바뀌면 여기만 고친다.
const DATE_CUTOFF_MS = 4 * WEEK_MS;
const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatRelativeTime(timestampMs: number, now: number = Date.now()): string {
  // 미래 타임스탬프(클럭 스큐, 낙관적 로컬 쓰기)는 "now"로 바닥을 둔다 — 음수 분/시간은 안 보여준다.
  const diff = Math.max(0, now - timestampMs);
  if (diff < MINUTE_MS) return "now";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h`;
  if (diff < WEEK_MS) return `${Math.floor(diff / DAY_MS)}d`;
  if (diff < DATE_CUTOFF_MS) return `${Math.floor(diff / WEEK_MS)}w`;
  const d = new Date(timestampMs);
  const yearSuffix = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MONTH_LABEL[d.getMonth()]}${yearSuffix}`;
}
