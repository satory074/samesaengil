// 366日の列挙（純関数）。aggregate.ts が全日を回すのに使う。
import type { MD } from "./almanac";

/** うるう年込みの月末日（2月は 29）。全366日を対象にするため。 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 1/1 〜 12/31（2/29 を含む 366 日）。 */
export function allDays(): MD[] {
  const out: MD[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++) out.push({ month: m, day: d });
  return out;
}
