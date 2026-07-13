// 366日ぶんの「誕生日データ」を生成して public/data/days/MM-DD.json に書き出す。
// ソース: 日本語版Wikipedia「M月D日」の誕生日節（人物リスト＋顔写真）+ 閲覧数(pageviews, 並び替え用の人気のみ) + 静的キャラJSON。
// 設計: ソース毎 try/catch、失敗時は前回ファイルへフォールバック（1ソース/1日が落ちても全体を壊さない）。
//
// 実行:
//   npm run aggregate            … 全366日
//   npm run aggregate 03-15      … 指定日のみ（argv）
//   ONLY_DAYS=03-15,07-04 npm run aggregate
//   CHARS_ONLY=1 npm run aggregate … Wikipedia を叩かず characters だけ差し替え（キャッシュ済みの人気で並べる）
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Anniversary, Character, DayData, DayEvent, Person } from "../src/lib/types";
import { fetchDayInfo, type JaRawBirth } from "./sources/jawikiDay";
import { mapLimit } from "./lib/util";
import { ensurePages, ensurePageviews, readState, resolveWorkFame, writeState, type State } from "./lib/state";
import { allDays } from "../src/lib/days";
import charactersSeed from "../src/data/characters.json";
import fanwebSeed from "../src/data/characters-fanweb.json";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "public", "data", "days");

const pad = (n: number): string => String(n).padStart(2, "0");

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

type CharSeedRow = { name: string; work: string; month: number; day: number; url?: string; color?: string };

/** 作品名から決定的に色チップ色（#rrggbb）を導出。同じ作品は常に同色。 */
function colorForWork(work: string): string {
  let h = 2166136261; // FNV-1a 32bit
  for (let i = 0; i < work.length; i++) {
    h ^= work.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return hslToHex(hue, 62, 52); // 彩度・明度は固定でビビッドに揃える
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n: number): string => Math.round(255 * f(n)).toString(16).padStart(2, "0");
  return `#${to(0)}${to(8)}${to(4)}`;
}

/** 2 つのキャラ seed に出てくる作品名（ユニーク、~7000件）。 */
function allWorks(): string[] {
  const seeds = [...(charactersSeed as CharSeedRow[]), ...(fanwebSeed as CharSeedRow[])];
  return [...new Set(seeds.map((c) => c.work).filter(Boolean))];
}

/**
 * 静的キャラ JSON を MM-DD -> Character[] にまとめる。
 * curated（characters.json、手描き color 維持）を先に入れ、続いて fanweb バルク
 * （characters-fanweb.json、color は作品名から自動導出）を追加。各日 name で重複排除
 * （curated 優先＝手描き色を残す）。最後に「作品の人気」順へ並べ替える。
 */
function buildCharacterMap(fame: Map<string, number>): Map<string, Character[]> {
  const map = new Map<string, Character[]>();
  const seen = new Map<string, Set<string>>(); // key -> その日の登録済み name 集合

  const add = (c: CharSeedRow, color: string | undefined): void => {
    const key = `${pad(c.month)}-${pad(c.day)}`;
    const names = seen.get(key) ?? new Set<string>();
    if (names.has(c.name)) return; // 同日同名は先勝ち（curated 優先）
    names.add(c.name);
    seen.set(key, names);
    const arr = map.get(key) ?? [];
    arr.push({ name: c.name, work: c.work, url: c.url, color });
    map.set(key, arr);
  };

  for (const c of charactersSeed as CharSeedRow[]) add(c, c.color); // 手描き色を維持
  for (const c of fanwebSeed as CharSeedRow[]) add(c, c.color ?? colorForWork(c.work));
  for (const arr of map.values()) rankCharacters(arr, fame);
  return map;
}

/**
 * 作品の閲覧数(人気)降順 → 作品名（同じ作品を隣接させる）→ 作品内は seed 順（Array#sort は安定）。
 * 1日 最大 ~1900 件あり初期表示は先頭40件なので、有名作品のキャラがそこに来るようにする。
 */
function rankCharacters(chars: Character[], fame: Map<string, number>): void {
  chars.sort((a, b) => {
    const d = (fame.get(b.work) ?? 0) - (fame.get(a.work) ?? 0);
    if (d !== 0) return d;
    return a.work < b.work ? -1 : a.work > b.work ? 1 : 0;
  });
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
  const state = readState();
  const charsOnly = Boolean(process.env.CHARS_ONLY);

  // キャラの並び替えに使う「作品の人気」（＝作品記事の年間閲覧数）。人物の fame と同じ仕組み・
  // 同じキャッシュ（state.pages/views）。CHARS_ONLY は Wikipedia を叩かずキャッシュ済みの分だけ使う。
  const fame = await resolveWorkFame(allWorks(), state, charsOnly);
  const ranked = [...fame.values()].filter((v) => v > 0).length;
  console.log(`[aggregate] 作品の人気: ${ranked}/${fame.size} 作品に閲覧数あり`);
  if (!charsOnly) writeState(state);

  const charMap = buildCharacterMap(fame);
  const days = selectDays();

  // 高速適用パス: Wikipedia を叩かず、既存 per-day ファイルの characters だけ差し替える。
  // キャラ JSON を更新した後、全366日へ数秒で反映するための経路（people 等は保持）。
  if (charsOnly) {
    let updated = 0;
    let missing = 0;
    for (const { month, day } of days) {
      const key = `${pad(month)}-${pad(day)}`;
      const filePath = path.join(DAYS_DIR, `${key}.json`);
      const prev = readJson<DayData | null>(filePath, null);
      if (!prev) {
        missing++;
        continue; // ファイルが無い日はスキップ（まず通常 aggregate が必要）
      }
      writeJson(filePath, { ...prev, characters: charMap.get(key) ?? [], updatedAt: new Date().toISOString() });
      updated++;
    }
    console.log(`[aggregate] CHARS_ONLY 完了: 更新${updated} / 欠落${missing} / 計${days.length}日`);
    return;
  }

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
      writeState(state); // 途中保存（落ちてもキャッシュが残る）
    }
  });

  writeState(state);
  console.log(`[aggregate] 完了: 成功${ok} / 警告${withErrors} / 計${days.length}日`);
}

run().catch((e) => {
  console.error("[aggregate] 致命的エラー:", e);
  process.exit(1);
});
