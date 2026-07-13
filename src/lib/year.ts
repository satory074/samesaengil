// 「生まれた年」データからの取り出し（純関数・DOM 非依存＝tsx でテスト可能）。
// per-year JSON は年単位なので、特定の誕生日への解決はここ（クライアント側）で行う。
import type { ChartWeek, YearData, YearEvent } from "./types";
import type { MD } from "./almanac";

const mdNum = (m: number, d: number): number => m * 100 + d;

/**
 * 生まれた「その瞬間に1位だった曲」＝ 誕生日以前で最も近い週の1位。
 * 年の最初の週より前（1月頭生まれ）は前年の最終週へフォールバック。
 */
export function songForBirthday(md: MD, y: YearData): ChartWeek | null {
  const target = mdNum(md.month, md.day);
  let best: ChartWeek | null = null;
  for (const w of y.chartWeeks) {
    if (mdNum(w.month, w.day) <= target) best = w; // chartWeeks は日付昇順
  }
  return best ?? y.prevYearLast;
}

/** 誕生日ぴったりのできごと（一番刺さる）。 */
export function eventOnBirthday(y: YearData, md: MD): YearEvent[] {
  return y.events.filter((e) => e.month === md.month && e.day === md.day);
}

/** 生まれた月のできごと（誕生日ぴったりの分は除く）。 */
export function eventsForMonth(y: YearData, md: MD): YearEvent[] {
  return y.events.filter((e) => e.month === md.month && e.day !== md.day);
}
