// 「生まれた年」データを生成して public/data/years/YYYY.json に書き出す。
// ソース: 日本語版Wikipedia「YYYY年」記事（できごと）＋「Template:オリコン週間シングルチャート第1位 YYYY年」。
// 設計は aggregate.ts と同じ: ソース毎 try/catch、失敗時は前回ファイルへフォールバック。
//
// 実行:
//   npm run aggregate:years              … 1900年〜今年
//   npx tsx scripts/aggregateYears.ts 1995 1968
//   ONLY_YEARS=1995,2000 npm run aggregate:years
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { ChartWeek, YearData } from "../src/lib/types";
import { fetchYearInfo } from "./sources/jawikiYear";
import { fetchOriconYear, ORICON_FIRST_YEAR } from "./sources/jawikiOricon";
import { mapLimit } from "./lib/util";

const ROOT = process.cwd();
const YEARS_DIR = path.join(ROOT, "public", "data", "years");

/** 出生年として現実的な範囲。index.astro の年セレクトが出す年は全部ファイルがある状態にする。 */
const FIRST_YEAR = 1900;

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 0) + "\n");
}

function selectYears(lastYear: number): number[] {
  const argv = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const fromEnv = (process.env.ONLY_YEARS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const wanted = [...argv, ...fromEnv].map(Number).filter((y) => Number.isFinite(y));
  if (wanted.length) return [...new Set(wanted)].sort((a, b) => a - b);
  const out: number[] = [];
  for (let y = FIRST_YEAR; y <= lastYear; y++) out.push(y);
  return out;
}

// 前年の最終週を引くため、同じ年のオリコン取得は 1 回に抑える（年をまたいで共有）。
const oriconCache = new Map<number, Promise<ChartWeek[]>>();
function getOricon(year: number): Promise<ChartWeek[]> {
  let p = oriconCache.get(year);
  if (!p) {
    p = fetchOriconYear(year).catch(() => [] as ChartWeek[]);
    oriconCache.set(year, p);
  }
  return p;
}

async function run(): Promise<void> {
  const lastYear = new Date().getFullYear();
  const years = selectYears(lastYear);
  const single = years.length === 1;
  const concurrency = single ? 1 : Number(process.env.YEAR_CONCURRENCY ?? 3);
  console.log(`[years] ${years.length}年ぶんを生成します（並列${concurrency}）…`);

  let ok = 0;
  let withErrors = 0;
  const emptyEvents: number[] = [];
  const emptyCharts: number[] = [];

  await mapLimit(years, concurrency, async (year) => {
    const filePath = path.join(YEARS_DIR, `${year}.json`);
    const prev = readJson<YearData | null>(filePath, null);
    const errs: string[] = [];

    let events = prev?.events ?? [];
    let highlights = prev?.highlights ?? [];
    try {
      const info = await fetchYearInfo(year);
      events = info.events;
      highlights = info.highlights;
    } catch (e) {
      errs.push(`jawikiYear: ${(e as Error).message}`);
    }

    let chartWeeks = prev?.chartWeeks ?? [];
    let prevYearLast = prev?.prevYearLast ?? null;
    try {
      const [cur, before] = await Promise.all([getOricon(year), getOricon(year - 1)]);
      chartWeeks = cur;
      prevYearLast = before.length ? before[before.length - 1] : null;
    } catch (e) {
      errs.push(`oricon: ${(e as Error).message}`);
    }

    const out: YearData = { year, events, highlights, chartWeeks, prevYearLast, updatedAt: new Date().toISOString() };
    writeJson(filePath, out);

    // パーサ破損をサイレントに見逃さないための報告（テンプレ/節構成は編集で変わる）。
    if (events.length === 0) emptyEvents.push(year);
    if (chartWeeks.length === 0 && year >= ORICON_FIRST_YEAR) emptyCharts.push(year);

    if (errs.length) {
      withErrors++;
      console.warn(`  ${year} ⚠ ${errs.join(" / ")}（前回値でフォールバック）`);
    } else {
      ok++;
    }
    if (single) {
      console.log(
        `  ${year}: できごと${events.length} / 主な出来事${highlights.length} / 週間1位${chartWeeks.length}週` +
          `${prevYearLast ? ` / 前年末「${prevYearLast.title}」` : ""}`,
      );
    }
  });

  console.log(`[years] 完了: 成功${ok} / 警告${withErrors} / 計${years.length}年`);
  if (emptyEvents.length) console.warn(`[years] ⚠ できごと0件: ${emptyEvents.join(", ")}`);
  if (emptyCharts.length) console.warn(`[years] ⚠ 週間1位0件（1968年以降なのに）: ${emptyCharts.join(", ")}`);
}

run().catch((e) => {
  console.error("[years] 致命的エラー:", e);
  process.exit(1);
});
