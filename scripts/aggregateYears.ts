// 「生まれた年」データを生成して public/data/years/YYYY.json に書き出す。
// ソース: 日本語版Wikipedia「YYYY年」記事（できごと）＋「Template:オリコン週間シングルチャート第1位 YYYY年」
//        ＋ Spotify（週間1位の曲ページ URL、資格情報があるときだけ）
//        ＋ 日別 JSON の逆引き（その年に生まれた有名人。API 呼び出しは無い＝下記）。
// 設計は aggregate.ts と同じ: ソース毎 try/catch、失敗時は前回ファイルへフォールバック。
//
// 実行:
//   npm run aggregate:years              … 1900年〜今年
//   npx tsx scripts/aggregateYears.ts 1995 1968
//   ONLY_YEARS=1995,2000 npm run aggregate:years
//   YEARS_PEOPLE_ONLY=1 npm run aggregate:years   … Wikipedia/Spotify を一切叩かず people だけ差し替え（数秒）
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { ChartWeek, DayData, YearData, YearPerson } from "../src/lib/types";
import { allDays } from "../src/lib/days";
import { categorize, cohortYearOf, type PersonCat } from "../src/lib/peers";
import { fetchYearInfo } from "./sources/jawikiYear";
import { fetchOriconYear, ORICON_FIRST_YEAR } from "./sources/jawikiOricon";
import { attachSpotify, hasSpotifyCreds, type SpotifyStats } from "./sources/spotify";
import { mapLimit } from "./lib/util";

const ROOT = process.cwd();
const YEARS_DIR = path.join(ROOT, "public", "data", "years");
const DAYS_DIR = path.join(ROOT, "public", "data", "days");
// 曲 → Spotify URL のキャッシュ（コミットする。"" は「Spotify に無い」の負キャッシュ）。
const SPOTIFY_PATH = path.join(ROOT, "src", "data", "spotify.json");

/** 出生年として現実的な範囲。index.astro の年セレクトが出す年は全部ファイルがある状態にする。 */
const FIRST_YEAR = 1900;

/**
 * カテゴリごとの保存上限（＝1年あたり最大 5カテゴリ × これ 人）。
 * 全件だと 1990年で 1824人・470KB になるが、年 JSON は診断のたびに fetch される
 * ホットパスなので上限は必須。人気（年間閲覧数）上位だけ残す。
 */
const PER_CAT_LIMIT = 30;

/** 逆引きの破損検知に使う範囲（この範囲で people が 0 件なら日別データか分類が壊れている）。 */
const PEOPLE_EXPECTED_FROM = 1920;
const PEOPLE_EXPECTED_TO = 2005;

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

/**
 * 日別 JSON（366ファイル）を**学年（年度。4/2〜翌4/1）**で逆引きして「同じ学年の有名人」を作る。
 * **API 呼び出しは 1 件も無い**（名前・肩書き・写真・人気は日別データが既に持っている）。
 * したがって日別 → 年 の順に実行する必要がある（CI もその順）。
 *
 * キーは暦年ではなく年度なので、YYYY.json の people は「YYYY/4/2〜YYYY+1/4/1 生まれ」＝
 * 早生まれ（翌年の1〜3月生まれ）が混ざる。events/chartWeeks は暦年のままであることに注意。
 */
function buildCohortPeople(): Map<number, YearPerson[]> {
  type Ranked = YearPerson & { fame: number };
  const byCohort = new Map<number, Ranked[]>();

  for (const { month, day } of allDays()) {
    const key = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const d = readJson<DayData | null>(path.join(DAYS_DIR, `${key}.json`), null);
    for (const p of d?.people ?? []) {
      if (!p.year) continue; // 生年非公表（year:0）は学年を決められない
      const cohort = cohortYearOf({ year: p.year, month, day });
      const list = byCohort.get(cohort) ?? [];
      list.push({
        name: p.name,
        year: p.year,
        month,
        day,
        desc: p.desc,
        photo: p.photo,
        url: p.url,
        fame: p.fame ?? 0,
      });
      byCohort.set(cohort, list);
    }
  }

  const out = new Map<number, YearPerson[]>();
  for (const [year, list] of byCohort) {
    // 並びは aggregate.ts の rankPeople と同じ規範（人気＝年間閲覧数 → 写真あり → 名前）。
    list.sort(
      (a, b) =>
        b.fame - a.fame ||
        Number(Boolean(b.photo)) - Number(Boolean(a.photo)) ||
        a.name.localeCompare(b.name),
    );
    const seen = new Set<string>();
    const perCat = new Map<PersonCat, number>();
    const kept: YearPerson[] = [];
    for (const p of list) {
      const dedupeKey = p.url || p.name;
      if (seen.has(dedupeKey)) continue;
      const cat = categorize(p.desc);
      const n = perCat.get(cat) ?? 0;
      if (n >= PER_CAT_LIMIT) continue;
      seen.add(dedupeKey);
      perCat.set(cat, n + 1);
      kept.push({
        name: p.name,
        year: p.year,
        month: p.month,
        day: p.day,
        desc: p.desc,
        photo: p.photo,
        url: p.url,
      });
    }
    out.set(year, kept);
  }
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
  // people だけの差し替えはローカル I/O のみ（Wikipedia/Oricon/Spotify を叩かない）。
  const peopleOnly = process.env.YEARS_PEOPLE_ONLY === "1";
  const concurrency = single ? 1 : Number(process.env.YEAR_CONCURRENCY ?? 3);
  console.log(
    `[years] ${years.length}年ぶんを生成します（並列${concurrency}）…${peopleOnly ? " ※people だけ差し替え" : ""}`,
  );

  console.log("[years] 日別JSONを学年（年度）で逆引きしています…");
  const peopleByYear = buildCohortPeople();
  // 日別ファイルが読めない（未生成など）ときに people を空で上書きしてしまわないための検知。
  const invertOk = [...peopleByYear.values()].some((l) => l.length > 0);
  if (!invertOk) {
    console.warn("[years] ⚠ 日別JSONから有名人を1人も逆引きできませんでした（people は前回値を維持します）");
  } else {
    console.log(`[years] 逆引き完了: ${peopleByYear.size}学年ぶん（先に npm run aggregate で日別を更新しておくこと）`);
  }

  const spotifyCache = readJson<Record<string, string>>(SPOTIFY_PATH, {});
  const spotify: SpotifyStats = { resolved: 0, missing: 0, failed: 0 };
  if (!peopleOnly && !hasSpotifyCreds()) {
    console.log("[years] SPOTIFY_CLIENT_ID/SECRET が無いので曲の解決はスキップ（キャッシュ済みの分だけ埋めます）");
  }

  let ok = 0;
  let withErrors = 0;
  let done = 0;
  const emptyEvents: number[] = [];
  const emptyCharts: number[] = [];
  const emptyPeople: number[] = [];

  await mapLimit(years, concurrency, async (year) => {
    const filePath = path.join(YEARS_DIR, `${year}.json`);
    const prev = readJson<YearData | null>(filePath, null);
    const errs: string[] = [];

    let events = prev?.events ?? [];
    let highlights = prev?.highlights ?? [];
    let chartWeeks = prev?.chartWeeks ?? [];
    let prevYearLast = prev?.prevYearLast ?? null;

    if (!peopleOnly) {
      try {
        const info = await fetchYearInfo(year);
        events = info.events;
        highlights = info.highlights;
      } catch (e) {
        errs.push(`jawikiYear: ${(e as Error).message}`);
      }

      try {
        const [cur, before] = await Promise.all([getOricon(year), getOricon(year - 1)]);
        chartWeeks = cur;
        prevYearLast = before.length ? before[before.length - 1] : null;
      } catch (e) {
        errs.push(`oricon: ${(e as Error).message}`);
      }

      // 各曲に Spotify の曲ページ URL を付ける（未解決でも表示側は検索 URL に落ちるので致命的でない）。
      try {
        await attachSpotify(prevYearLast ? [...chartWeeks, prevYearLast] : chartWeeks, spotifyCache, spotify);
      } catch (e) {
        errs.push(`spotify: ${(e as Error).message}`);
      }
    }

    const people = invertOk ? (peopleByYear.get(year) ?? []) : (prev?.people ?? []);

    const out: YearData = {
      year,
      events,
      highlights,
      chartWeeks,
      prevYearLast,
      people,
      updatedAt: new Date().toISOString(),
    };
    writeJson(filePath, out);

    // パーサ破損をサイレントに見逃さないための報告（テンプレ/節構成は編集で変わる）。
    if (!peopleOnly && events.length === 0) emptyEvents.push(year);
    if (!peopleOnly && chartWeeks.length === 0 && year >= ORICON_FIRST_YEAR) emptyCharts.push(year);
    if (people.length === 0 && year >= PEOPLE_EXPECTED_FROM && year <= PEOPLE_EXPECTED_TO) emptyPeople.push(year);

    done++;
    if (errs.length) {
      withErrors++;
      console.warn(`  ${year} ⚠ ${errs.join(" / ")}（前回値でフォールバック）`);
    } else {
      ok++;
    }
    if (single) {
      console.log(
        `  ${year}: できごと${events.length} / 主な出来事${highlights.length} / 週間1位${chartWeeks.length}週` +
          ` / 有名人${people.length}人${prevYearLast ? ` / 前年末「${prevYearLast.title}」` : ""}`,
      );
    } else if (done % 20 === 0) {
      console.log(`  …${done}/${years.length}`);
      if (!peopleOnly) writeJson(SPOTIFY_PATH, spotifyCache); // 途中保存（落ちても解決済みの曲は残す）
    }
  });

  if (!peopleOnly) writeJson(SPOTIFY_PATH, spotifyCache);
  console.log(`[years] 完了: 成功${ok} / 警告${withErrors} / 計${years.length}年`);
  if (!peopleOnly) {
    console.log(
      `[years] Spotify: 新規${spotify.resolved} / 未収録${spotify.missing} / 失敗${spotify.failed}` +
        `（キャッシュ計${Object.keys(spotifyCache).length}曲）`,
    );
  }
  if (emptyEvents.length) console.warn(`[years] ⚠ できごと0件: ${emptyEvents.join(", ")}`);
  if (emptyCharts.length) console.warn(`[years] ⚠ 週間1位0件（1968年以降なのに）: ${emptyCharts.join(", ")}`);
  if (emptyPeople.length) console.warn(`[years] ⚠ 有名人0人（逆引きの破損を疑う）: ${emptyPeople.join(", ")}`);
}

run().catch((e) => {
  console.error("[years] 致命的エラー:", e);
  process.exit(1);
});
