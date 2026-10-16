// Pure local-time logic. SQL always groups by UTC hour; this module maps UTC hours to local
// labels/dates and local calendar ranges to [fromUtc, toUtc). Uses Intl only (no tz library).
export const DEFAULT_TIMEZONE = 'Europe/Amsterdam';
export const MAX_RANGE_DAYS = 92;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export type RangeInput =
  | 'today' | 'yesterday' | '7d' | '14d' | '30d'
  | { from: string; to: string };

export interface Bucket {
  key: string;      // hourly: ISO UTC hour start; daily: local date YYYY-MM-DD
  label: string;    // hourly: 00..23, 02a/02b on repeated hour; daily: YYYY-MM-DD
  startUtc: number;
  endUtc: number;
}

export interface ResolvedRange {
  kind: string;
  granularity: 'hour' | 'day';
  timezone: string;
  fromUtc: number;
  toUtc: number;               // exclusive
  fromDate: string;            // local, inclusive
  toDate: string;              // local, inclusive
  days: number;
  clamped: boolean;
  buckets: Bucket[];
  prior: { fromUtc: number; toUtc: number };
  clockChange: boolean;        // hourly day with 23 or 25 hours
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; m: number; d: number; h: number }
export function localParts(utcMs: number, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! };
}

/** Offset of tz from UTC in minutes at an instant (local = utc + offset). */
export function offsetMinutes(utcMs: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, '0');
export function localDate(utcMs: number, tz: string): string {
  const { y, m, d } = localParts(utcMs, tz);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The timezone must be a valid IANA zone with whole-hour UTC offsets all year. */
export function validateTimezone(tz: string): string | null {
  try { fmt(tz); } catch { return `Unknown timezone "${tz}"`; }
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 365 * 2; i += 3) {
    if (offsetMinutes(start + i * DAY, tz) % 60 !== 0) {
      return `Timezone "${tz}" has a non-whole-hour UTC offset; hourly buckets need whole-hour offsets`;
    }
  }
  return null;
}

export function parseDate(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function addDays(date: string, n: number): string {
  const p = parseDate(date)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const a = parseDate(from)!, b = parseDate(to)!;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
}

/** UTC instant of local 00:00 on a local date (earliest if ambiguous). */
export function localMidnightUtc(date: string, tz: string): number {
  const p = parseDate(date);
  if (!p) throw new Error(`Invalid date ${date}`);
  const t = Date.UTC(p.y, p.m - 1, p.d);
  const offsets = new Set([offsetMinutes(t - DAY, tz), offsetMinutes(t, tz), offsetMinutes(t + DAY, tz)]);
  const hits: number[] = [];
  for (const off of offsets) {
    const cand = t - off * 60_000;
    const lp = localParts(cand, tz);
    if (lp.y === p.y && lp.m === p.m && lp.d === p.d && lp.h === 0) hits.push(cand);
  }
  if (!hits.length) throw new Error(`No local midnight for ${date} in ${tz}`);
  return Math.min(...hits);
}

/** Hourly buckets covering [fromUtc, toUtc); repeated local hours become 02a/02b. */
export function hourBuckets(fromUtc: number, toUtc: number, tz: string): Bucket[] {
  const raw: { s: number; hh: string }[] = [];
  for (let s = fromUtc; s < toUtc; s += HOUR) raw.push({ s, hh: pad(localParts(s, tz).h) });
  const count = new Map<string, number>();
  for (const r of raw) count.set(r.hh, (count.get(r.hh) ?? 0) + 1);
  const seen = new Map<string, number>();
  return raw.map(({ s, hh }) => {
    const n = (seen.get(hh) ?? 0) + 1;
    seen.set(hh, n);
    const label = (count.get(hh) ?? 1) > 1 ? `${hh}${n === 1 ? 'a' : 'b'}` : hh;
    return { key: new Date(s).toISOString(), label, startUtc: s, endUtc: s + HOUR };
  });
}

export function dayBuckets(fromDate: string, toDate: string, tz: string): Bucket[] {
  const out: Bucket[] = [];
  const n = daysBetween(fromDate, toDate);
  for (let i = 0; i <= n; i++) {
    const d = addDays(fromDate, i);
    out.push({ key: d, label: d, startUtc: localMidnightUtc(d, tz), endUtc: localMidnightUtc(addDays(d, 1), tz) });
  }
  return out;
}

/** Resolve a range selection against `nowMs` in `tz`. Throws RangeError on invalid input. */
export function resolveRange(range: RangeInput, nowMs: number, tz: string): ResolvedRange {
  const today = localDate(nowMs, tz);
  let fromDate: string, toDate: string, kind: string, clamped = false;
  if (range === 'today') { kind = 'today'; fromDate = toDate = today; }
  else if (range === 'yesterday') { kind = 'yesterday'; fromDate = toDate = addDays(today, -1); }
  else if (range === '7d' || range === '14d' || range === '30d') {
    kind = range; toDate = today; fromDate = addDays(today, -(Number.parseInt(range, 10) - 1));
  } else if (range && typeof range === 'object') {
    kind = 'custom';
    if (!parseDate(range.from) || !parseDate(range.to)) throw new RangeError('Custom range needs from/to as YYYY-MM-DD');
    fromDate = range.from; toDate = range.to;
    if (toDate > today) toDate = today;
    if (fromDate > toDate) throw new RangeError('Range start is after its end');
    if (daysBetween(fromDate, toDate) + 1 > MAX_RANGE_DAYS) {
      fromDate = addDays(toDate, -(MAX_RANGE_DAYS - 1)); clamped = true;
    }
  } else throw new RangeError('Unknown range');

  const days = daysBetween(fromDate, toDate) + 1;
  const granularity = kind === 'today' || kind === 'yesterday' ? 'hour' : 'day';
  const fromUtc = localMidnightUtc(fromDate, tz);
  const toUtc = localMidnightUtc(addDays(toDate, 1), tz);
  const buckets = granularity === 'hour' ? hourBuckets(fromUtc, toUtc, tz) : dayBuckets(fromDate, toDate, tz);

  // Prior window: equal-length calendar window; for today, same elapsed time yesterday.
  let prior: { fromUtc: number; toUtc: number };
  if (kind === 'today') {
    const yFrom = localMidnightUtc(addDays(today, -1), tz);
    prior = { fromUtc: yFrom, toUtc: Math.min(fromUtc, yFrom + Math.max(0, nowMs - fromUtc)) };
  } else {
    prior = { fromUtc: localMidnightUtc(addDays(fromDate, -days), tz), toUtc: fromUtc };
  }
  return {
    kind, granularity, timezone: tz, fromUtc, toUtc, fromDate, toDate, days, clamped, buckets, prior,
    clockChange: granularity === 'hour' && buckets.length !== 24,
  };
}
