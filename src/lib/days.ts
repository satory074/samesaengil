// 366日の列挙とキー変換（純関数）。aggregate.ts・日別ページ（getStaticPaths）・クライアントで共有。
import type { MD } from "./almanac";

/** うるう年込みの月末日（2月は 29）。全366日を対象にするため。 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number): string => String(n).padStart(2, "0");

/** 1/1 〜 12/31（2/29 を含む 366 日）。 */
export function allDays(): MD[] {
  const out: MD[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++) out.push({ month: m, day: d });
  return out;
}

/** "MM-DD"（per-day JSON のファイル名・日別ページの URL と同じ形）。 */
export function dayKeyOf({ month, day }: MD): string {
  return `${pad(month)}-${pad(day)}`;
}

/** "MM-DD" → MD。366 日に無いキー（13-01 や 02-30）は null。 */
export function parseDayKey(key: string): MD | null {
  const m = /^(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return { month, day };
}

/** "6月18日"。 */
export function dayLabel({ month, day }: MD): string {
  return `${month}月${day}日`;
}

/** 前の日・次の日（12/31 の次は 1/1。日別ページの前後リンク用）。 */
export function neighborDays(md: MD): { prev: MD; next: MD } {
  const days = allDays();
  const i = days.findIndex((d) => d.month === md.month && d.day === md.day);
  return { prev: days[(i - 1 + days.length) % days.length], next: days[(i + 1) % days.length] };
}
