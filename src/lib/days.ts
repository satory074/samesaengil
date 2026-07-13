// 366日の列挙とキー変換（純関数）。ビルドスクリプト・getStaticPaths・クライアントで共有。
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

/** "MM-DD"。 */
export function dayKeyOf({ month, day }: MD): string {
  return `${pad(month)}-${pad(day)}`;
}

/** "MM-DD" → MD。不正なキーは null（getStaticPaths 外からの推測アクセス対策）。 */
export function parseDayKey(key: string): MD | null {
  const m = /^(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return { month, day };
}

/** "7月7日"。 */
export function dayLabel({ month, day }: MD): string {
  return `${month}月${day}日`;
}
