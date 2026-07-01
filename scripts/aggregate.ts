// 366日ぶんの「誕生日データ」を生成して public/data/days/MM-DD.json に書き出す。
// ソース: 日本語版Wikipedia「M月D日」の誕生日節（人物リスト＋顔写真）+ Wikidata(wbgetentities, 並び替え用の知名度のみ) + 静的キャラJSON。
// 設計: ソース毎 try/catch、失敗時は前回ファイルへフォールバック（1ソース/1日が落ちても全体を壊さない）。
//
// 実行:
//   npm run aggregate            … 全366日
//   npm run aggregate 03-15      … 指定日のみ（argv）
//   ONLY_DAYS=03-15,07-04 npm run aggregate
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Anniversary, Character, DayData, DayEvent, Person } from "../src/lib/types";
import { fetchDayInfo, type JaRawBirth } from "./sources/jawikiDay";
import { fetchPageMeta, type PageMeta } from "./sources/jawikiPageMeta";
import { fetchPageviews, last12Months } from "./sources/jawikiPageviews";
import { mapLimit } from "./lib/util";
import charactersSeed from "../src/data/characters.json";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "public", "data", "days");
const STATE_PATH = path.join(ROOT, "src", "data", "state.json");

interface State {
  pages: Record<string, PageMeta>; // jawiki title -> {qid, photo, title(正規化後)}（負キャッシュは {}）
  views: Record<string, number>; // 正規化後タイトル -> 日本語版Wikipedia の年間閲覧数（人気指標）
}

// 閲覧数の集計期間（実行時に直近12か月を確定）。
const PV_WINDOW = last12Months(new Date());

const pad = (n: number): string => String(n).padStart(2, "0");
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function allDays(): { month: number; day: number }[] {
  const out: { month: number; day: number }[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++) out.push({ month: m, day: d });
  return out;
}

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

/** 静的キャラ JSON を MM-DD -> Character[] にまとめる。 */
function buildCharacterMap(): Map<string, Character[]> {
  const map = new Map<string, Character[]>();
  for (const c of charactersSeed as { name: string; work: string; month: number; day: number; url?: string; color?: string }[]) {
    const key = `${pad(c.month)}-${pad(c.day)}`;
    const arr = map.get(key) ?? [];
    arr.push({ name: c.name, work: c.work, url: c.url, color: c.color });
    map.set(key, arr);
  }
  return map;
}

function selectDays(): { month: number; day: number }[] {
  const argv = process.argv.slice(2).filter((a) => /^\d{1,2}-\d{1,2}$/.test(a));
  const fromEnv = (process.env.ONLY_DAYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const wanted = new Set([...argv, ...fromEnv].map((s) => {
    const [m, d] = s.split("-").map(Number);
    return `${pad(m)}-${pad(d)}`;
  }));
  if (wanted.size === 0) return allDays();
  return allDays().filter(({ month, day }) => wanted.has(`${pad(month)}-${pad(day)}`));
}

/** 年・年代など「人物でない」エントリ名を除外（保険）。 */
function isYearLike(name: string): boolean {
  const n = name.trim();
  return /^(紀元前)?\d{1,4}年?$/.test(n) || /^AD\s*\d{1,4}$/i.test(n) || /^\d{1,4}\s*(BC|BCE|CE)$/i.test(n);
}

/** 閲覧数(fame) 降順 → 写真あり → 生年新しい順（人気＝よく見られている人を上へ）。 */
function rankPeople(people: Person[]): void {
  people.sort((a, b) => {
    if (b.fame !== a.fame) return b.fame - a.fame;
    if ((b.photo ? 1 : 0) !== (a.photo ? 1 : 0)) return (b.photo ? 1 : 0) - (a.photo ? 1 : 0);
    return b.year - a.year;
  });
}

/** 日本語版「誕生日」1 行 → Person（＋dedup 用の正規化タイトル）。fame は ja Wikipedia の年間閲覧数。 */
function personFromJa(b: JaRawBirth, state: State): { person: Person; canon: string } {
  const meta = state.pages[b.title] ?? {};
  const canon = meta.title ?? b.title; // リダイレクト解決後の実タイトル
  return {
    canon,
    person: {
      name: b.name,
      nameEn: "",
      year: b.year ?? 0,
      desc: b.descJa,
      photo: meta.photo ?? "",
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(b.title)}`,
      jaKnown: true,
      fame: state.views[canon] ?? 0, // 年間閲覧数＝日本での人気指標
    },
  };
}

/** ja タイトル群を {qid,photo,正規化タイトル} に解決（state.pages にキャッシュ、負キャッシュ込み）。 */
async function ensurePages(titles: string[], state: State): Promise<void> {
  const need = [...new Set(titles.filter(Boolean))].filter((t) => {
    const m = state.pages[t];
    if (m === undefined) return true; // 未取得
    if (m.title) return false; // 正規化タイトルあり＝最新
    return Boolean(m.qid || m.photo); // 旧キャッシュ（正規化タイトル欠落）は再取得。{} は負キャッシュで据置
  });
  if (need.length === 0) return;
  const fetched = await fetchPageMeta(need);
  for (const t of need) state.pages[t] = fetched.get(t) ?? {}; // 無ければ {} で負キャッシュ
}

/** 正規化タイトル群の未キャッシュ分だけ閲覧数を取得（state.views にキャッシュ）。 */
async function ensurePageviews(titles: string[], state: State): Promise<void> {
  const need = [...new Set(titles.filter(Boolean))].filter((t) => !(t in state.views));
  if (need.length === 0) return;
  const fetched = await fetchPageviews(need, PV_WINDOW.start, PV_WINDOW.end);
  for (const t of need) state.views[t] = fetched.get(t) ?? 0;
}

/**
 * 日本語版Wikipedia「誕生日」節から人物一覧＋動物一覧を構築（人物リストは日本語版のみ）。
 * 名前・肩書きは日本語リスト由来、写真は ja pageimages、並び替えは ja Wikipedia の閲覧数(=人気)。
 */
async function buildPeopleAndAnimals(
  jaBirths: JaRawBirth[],
  jaAnimals: JaRawBirth[],
  state: State,
): Promise<{ people: Person[]; animals: Person[] }> {
  const all = [...jaBirths, ...jaAnimals];
  // 1) ja タイトルを {photo, 正規化タイトル} に解決（キャッシュ）。
  await ensurePages(all.map((b) => b.title), state);
  // 2) 正規化タイトルの閲覧数を取得（人気指標・キャッシュ）。
  await ensurePageviews(all.map((b) => state.pages[b.title]?.title ?? b.title), state);

  // 3) 人物を構築。正規化タイトルで一意化。
  const byKey = new Map<string, Person>();
  for (const b of jaBirths) {
    const { person, canon } = personFromJa(b, state);
    if (!byKey.has(canon)) byKey.set(canon, person);
  }
  const people = [...byKey.values()].filter((p) => !isYearLike(p.name));
  rankPeople(people);

  // 4) 動物（人物以外）。
  const animals = jaAnimals.map((b) => personFromJa(b, state).person).filter((p) => !isYearLike(p.name));
  rankPeople(animals);

  return { people, animals };
}

async function run(): Promise<void> {
  const state = readJson<State>(STATE_PATH, { pages: {}, views: {} });
  state.pages ??= {};
  state.views ??= {};
  // 旧スキーマの未使用キャッシュ（Wikidata entities 等）を捨てて state.json を軽く保つ。
  const legacy = state as unknown as Record<string, unknown>;
  delete legacy.entities;
  delete legacy.translations;
  delete legacy.enrichVersion;

  const charMap = buildCharacterMap();
  const days = selectDays();
  const single = days.length === 1;
  // 日単位で並列（Wikimedia への礼儀として控えめ）。AGG_CONCURRENCY で上書き可。
  const concurrency = single ? 1 : Number(process.env.AGG_CONCURRENCY ?? 3);
  console.log(`[aggregate] ${days.length}日ぶんを生成します（並列${concurrency}）…`);

  let ok = 0;
  let withErrors = 0;
  let done = 0;

  await mapLimit(days, concurrency, async ({ month, day }) => {
    const key = `${pad(month)}-${pad(day)}`;
    const filePath = path.join(DAYS_DIR, `${key}.json`);
    const prev = readJson<DayData | null>(filePath, null);
    const errs: string[] = [];

    // 日本語版「M月D日」: 記念日・できごと・誕生日（人物/動物）を 1 ページから取得。
    let anniversaries: Anniversary[] = prev?.anniversaries ?? [];
    let events: DayEvent[] = prev?.events ?? [];
    let jaBirths: JaRawBirth[] | null = null;
    let jaAnimals: JaRawBirth[] = [];
    try {
      const info = await fetchDayInfo(month, day);
      anniversaries = info.anniversaries;
      events = info.events;
      jaBirths = info.births;
      jaAnimals = info.animals;
    } catch (e) {
      errs.push(`jawiki: ${(e as Error).message}`);
    }

    // 人物・動物を構築。jawiki 誕生日が取れなかった時のみ前回値へフォールバック（網羅性を落とさない）。
    let people: Person[];
    let animals: Person[];
    if (jaBirths === null) {
      people = prev?.people ?? [];
      animals = prev?.animals ?? [];
    } else {
      try {
        ({ people, animals } = await buildPeopleAndAnimals(jaBirths, jaAnimals, state));
      } catch (e) {
        errs.push(`people: ${(e as Error).message}`);
        people = prev?.people ?? [];
        animals = prev?.animals ?? [];
      }
    }

    const out: DayData = {
      date: key,
      people,
      animals,
      characters: charMap.get(key) ?? [],
      anniversaries,
      events,
      updatedAt: new Date().toISOString(),
    };
    writeJson(filePath, out);

    done++;
    if (errs.length) {
      withErrors++;
      console.warn(`  ${key} ⚠ ${errs.join(" / ")}（前回値でフォールバック）`);
    } else {
      ok++;
    }
    if (single) {
      console.log(`  ${key}: 有名人${people.length} / 動物${animals.length} / キャラ${out.characters.length} / 記念日${anniversaries.length} / できごと${events.length}`);
    } else if (done % 20 === 0) {
      console.log(`  …${done}/${days.length}`);
      writeJson(STATE_PATH, state); // 途中保存（落ちてもキャッシュが残る）
    }
  });

  writeJson(STATE_PATH, state);
  console.log(`[aggregate] 完了: 成功${ok} / 警告${withErrors} / 計${days.length}日`);
}

run().catch((e) => {
  console.error("[aggregate] 致命的エラー:", e);
  process.exit(1);
});
