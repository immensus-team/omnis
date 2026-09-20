/** A3 §6: 5-field cron, TZ=Asia/Seoul. Asia/Seoul has no DST, so this converts with a fixed +9h.
 *  ponytail: minute-by-minute linear scan (366-day cap). It is called once right after a job runs,
 *  so the cost never matters. If a DST timezone is ever needed, swap in an Intl.DateTimeFormat
 *  based conversion. */
export const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

function parseField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const slash = part.split("/");
    const rangePart = slash[0];
    const stepPart = slash[1];
    if (rangePart === undefined || slash.length > 2) throw new Error(`bad cron field: ${part}`);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      const a = Number(bounds[0]);
      const b = bounds.length > 1 ? Number(bounds[1]) : a;
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`bad cron range: ${part}`);
      lo = a;
      hi = b;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron field out of range: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function nextRunAt(cron: string, from: Date): Date {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error(`cron must have 5 fields, got ${fields.length}: ${cron}`);
  const field = (i: number): string => {
    const v = fields[i];
    if (v === undefined) throw new Error(`cron field ${i} missing: ${cron}`);
    return v;
  };
  const minutes = parseField(field(0), 0, 59);
  const hours = parseField(field(1), 0, 23);
  const doms = parseField(field(2), 1, 31);
  const months = parseField(field(3), 1, 12);
  const dows = parseField(field(4), 0, 6);
  const domStar = field(2) === "*";
  const dowStar = field(4) === "*";

  let t = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = t + 366 * 24 * 60 * MINUTE_MS;
  for (; t <= limit; t += MINUTE_MS) {
    const seoul = new Date(t + SEOUL_OFFSET_MS);
    if (!minutes.has(seoul.getUTCMinutes())) continue;
    if (!hours.has(seoul.getUTCHours())) continue;
    if (!months.has(seoul.getUTCMonth() + 1)) continue;
    const domOk = doms.has(seoul.getUTCDate());
    const dowOk = dows.has(seoul.getUTCDay());
    // POSIX cron: when both dom and dow are restricted, OR them; when only one is, use only that.
    const dayOk = domStar && dowStar ? true : domStar ? dowOk : dowStar ? domOk : domOk || dowOk;
    if (dayOk) return new Date(t);
  }
  throw new Error(`no cron occurrence within 366 days: ${cron}`);
}
