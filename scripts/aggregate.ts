// 366日ぶんの「誕生日データ」を生成して public/data/days/MM-DD.json に書き出す。
// ソース: 英語版Wikipedia births + Wikidata(wbgetentities) + 日本語版Wikipedia「M月D日」+ 静的キャラJSON。
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
import { fetchBirths, type RawPerson } from "./sources/wikiBirths";
import { fetchEntities, type Enriched } from "./sources/wikidataEntities";
import { fetchDayInfo, type JaRawBirth } from "./sources/jawikiDay";
import { fetchPageMeta, type PageMeta } from "./sources/jawikiPageMeta";
import { translateToJa } from "./sources/translate";
import { mapLimit } from "./lib/util";
import charactersSeed from "../src/data/characters.json";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "public", "data", "days");
const STATE_PATH = path.join(ROOT, "src", "data", "state.json");
const ENRICH_VERSION = "1"; // 翻訳ロジックを変えたら上げる → 旧キャッシュ破棄

interface State {
  entities: Record<string, Enriched>;
  translations: Record<string, string>; // descEn -> descJa
  pages: Record<string, PageMeta>; // jawiki title -> {qid, photo}（負キャッシュは {}）
  enrichVersion: string;
}

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

/** 英語 description のうち日本語化が必要なものを翻訳キャッシュに溜める。 */
async function ensureTranslations(descs: string[], state: State): Promise<void> {
  const need = [...new Set(descs)].filter((d) => d && !(d in state.translations));
  if (need.length === 0) return;
  const translated = await translateToJa(need);
  need.forEach((d, i) => {
    const ja = translated[i];
    if (ja) state.translations[d] = ja;
  });
}

/** 年・年代など「人物でない」エントリ名を除外（英語 births の pages[0] が年記事のことがある）。 */
function isYearLike(name: string): boolean {
  const n = name.trim();
  return /^(紀元前)?\d{1,4}年?$/.test(n) || /^AD\s*\d{1,4}$/i.test(n) || /^\d{1,4}\s*(BC|BCE|CE)$/i.test(n);
}

/** fame 降順 → 写真あり → 生年新しい順（現代の有名人を上へ）。 */
function rankPeople(people: Person[]): void {
  people.sort((a, b) => {
    if (b.fame !== a.fame) return b.fame - a.fame;
    if ((b.photo ? 1 : 0) !== (a.photo ? 1 : 0)) return (b.photo ? 1 : 0) - (a.photo ? 1 : 0);
    return b.year - a.year;
  });
}

/** 日本語版「誕生日」1 行 → Person（＋dedup 用 Q-ID）。 */
function personFromJa(b: JaRawBirth, state: State): { person: Person; qid?: string } {
  const meta = state.pages[b.title] ?? {};
  const e = (meta.qid && state.entities[meta.qid]) || { fame: 0, jaKnown: true };
  return {
    qid: meta.qid,
    person: {
      name: b.name,
      nameEn: "",
      year: b.year ?? 0,
      desc: b.descJa || e.descJa || "",
      photo: meta.photo ?? "",
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(b.title)}`,
      jaKnown: true,
      fame: e.fame,
    },
  };
}

/** 英語版 births 1 件 → Person（既存ロジック）。 */
function personFromEn(r: RawPerson, state: State): { person: Person; qid: string } {
  const e = state.entities[r.qid] ?? { fame: 0, jaKnown: false };
  return {
    qid: r.qid,
    person: {
      name: e.nameJa || r.nameEn,
      nameEn: r.nameEn,
      year: r.year,
      desc: e.descJa || state.translations[r.descEn] || r.descEn,
      photo: r.photo,
      url: r.url,
      jaKnown: e.jaKnown,
      fame: e.fame,
    },
  };
}

/** ja タイトル群を {qid,photo} に解決（state.pages にキャッシュ、負キャッシュ込み）。 */
async function ensurePages(titles: string[], state: State): Promise<void> {
  const need = [...new Set(titles.filter(Boolean))].filter((t) => !(t in state.pages));
  if (need.length === 0) return;
  const fetched = await fetchPageMeta(need);
  for (const t of need) state.pages[t] = fetched.get(t) ?? {}; // 無ければ {} で負キャッシュ
}

/** 解決済み state を前提に、Q-ID 群の未キャッシュ分だけ fame 補完。 */
async function ensureEntities(qids: string[], state: State): Promise<void> {
  const missing = [...new Set(qids.filter(Boolean))].filter((q) => !(q in state.entities));
  if (missing.length > 0) {
    const fetched = await fetchEntities(missing);
    for (const [q, e] of fetched) state.entities[q] = e;
  }
}

/**
 * 英語版 births と 日本語版「誕生日」をマージした人物一覧＋動物一覧を構築。
 * 日本語側を基準に名前・肩書きを優先し、写真は存在する方を採用。Q-ID で重複排除。
 */
async function buildPeopleAndAnimals(
  enRaw: RawPerson[],
  jaBirths: JaRawBirth[],
  jaAnimals: JaRawBirth[],
  state: State,
): Promise<{ people: Person[]; animals: Person[] }> {
  // 1) ja タイトルを {qid,photo} に解決（キャッシュ）。
  await ensurePages([...jaBirths, ...jaAnimals].map((b) => b.title), state);

  // 2) ja + en の Q-ID をまとめて fame 補完（キャッシュ）。
  const jaQids = [...jaBirths, ...jaAnimals]
    .map((b) => state.pages[b.title]?.qid)
    .filter((q): q is string => Boolean(q));
  await ensureEntities([...enRaw.map((r) => r.qid), ...jaQids], state);

  // 3) 英語 description の日本語化（任意・キャッシュ。英語のみで載る人物のため）。
  const needTranslate = enRaw
    .filter((r) => !state.entities[r.qid]?.descJa && r.descEn)
    .map((r) => r.descEn);
  await ensureTranslations(needTranslate, state);

  // 4) マージ。ja を基準に入れ、en は Q-ID 一致なら写真補完・不一致なら追加。
  const byKey = new Map<string, Person>();
  const keyOf = (qid: string | undefined, p: Person): string =>
    qid ? `q:${qid}` : `n:${p.name}:${p.year}`;

  for (const b of jaBirths) {
    const { person, qid } = personFromJa(b, state);
    const key = keyOf(qid, person);
    if (!byKey.has(key)) byKey.set(key, person);
  }
  for (const r of enRaw) {
    const { person, qid } = personFromEn(r, state);
    const key = keyOf(qid, person);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.photo && person.photo) existing.photo = person.photo; // 写真は良い方を補完
    } else {
      byKey.set(key, person);
    }
  }

  const people = [...byKey.values()].filter((p) => !isYearLike(p.name));
  rankPeople(people);

  // 5) 動物（英語ソース無し）。
  const animals = jaAnimals.map((b) => personFromJa(b, state).person).filter((p) => !isYearLike(p.name));
  rankPeople(animals);

  return { people, animals };
}

async function run(): Promise<void> {
  const state = readJson<State>(STATE_PATH, {
    entities: {},
    translations: {},
    pages: {},
    enrichVersion: ENRICH_VERSION,
  });
  if (state.enrichVersion !== ENRICH_VERSION) {
    state.translations = {};
    state.enrichVersion = ENRICH_VERSION;
  }
  state.entities ??= {};
  state.translations ??= {};
  state.pages ??= {};

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

    // 英語版 births（任意。落ちても日本語側だけで続行）。
    let enRaw: RawPerson[] = [];
    try {
      enRaw = await fetchBirths(month, day);
    } catch (e) {
      errs.push(`en-births: ${(e as Error).message}`);
    }

    // 人物・動物を構築。jawiki 誕生日が取れなかった時のみ前回値へフォールバック（網羅性を落とさない）。
    let people: Person[];
    let animals: Person[];
    if (jaBirths === null) {
      people = prev?.people ?? [];
      animals = prev?.animals ?? [];
    } else {
      try {
        ({ people, animals } = await buildPeopleAndAnimals(enRaw, jaBirths, jaAnimals, state));
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
