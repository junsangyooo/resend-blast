/**
 * Schedule time-zone helpers — shared by client and server.
 *
 * Scheduling uses ONE fixed time zone from brand.config `schedule` (default KST, UTC+9, no DST).
 * All storage is UTC ISO; conversion uses the fixed offset, so the result never depends on the
 * server's or the browser's local time zone (a server set to e.g. America/Los_Angeles with DST
 * still gets the same instant). The "kst" names are historical; they mean "the schedule zone".
 */
import { brand } from "../brand.config";

export const KST_OFFSET_MS = brand.schedule.utcOffsetMinutes * 60 * 1000;
/** Label shown next to every schedule time (e.g. "KST"). */
export const ZONE_LABEL = brand.schedule.timeZoneLabel;
/** "UTC+9" / "UTC-5:30" — tooltip text for the zone label. */
export const ZONE_UTC = (() => {
  const m = brand.schedule.utcOffsetMinutes;
  const sign = m < 0 ? "-" : "+";
  const a = Math.abs(m);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
})();

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-11-12" + "09:30" (schedule-zone wall clock) → Date (absolute instant). Invalid → null. */
export function kstInputToDate(date: string, time: string): Date | null {
  const d = DATE_RE.exec(String(date ?? "").trim());
  const t = TIME_RE.exec(String(time ?? "").trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hh, mi] = [Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return null;
  const utcMs = Date.UTC(y, mo - 1, da, hh, mi) - KST_OFFSET_MS;
  const out = new Date(utcMs);
  // Reject overflow like 02-31 (Date.UTC silently rolls over).
  const back = toKstParts(out);
  if (back.date !== `${d[1]}-${d[2]}-${d[3]}` || back.time !== `${t[1]}:${t[2]}`) return null;
  return out;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → schedule-zone wall clock parts for <input type=date/time>. */
export function toKstParts(d: Date): { date: string; time: string } {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    time: `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`,
  };
}

/** ISO/Date → "11월 12일 (목) 09:30" in the schedule zone. withYear adds "2026년 ". */
export function formatKst(input: string | Date, opts: { withYear?: boolean } = {}): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (!Number.isFinite(d.getTime())) return "";
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const y = opts.withYear ? `${k.getUTCFullYear()}년 ` : "";
  return `${y}${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 (${WEEKDAYS[k.getUTCDay()]}) ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}

/** "3시간 12분 후" / "5분 전" relative to now. */
export function relativeFromNow(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff)) return "";
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  let s: string;
  if (m < 1) s = "1분 미만";
  else if (m < 60) s = `${m}분`;
  else if (m < 60 * 24) s = `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
  else s = `${Math.floor(m / (60 * 24))}일`;
  return diff >= 0 ? `${s} 후` : `${s} 전`;
}
