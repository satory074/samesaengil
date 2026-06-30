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
import { fetchBirths } from "./sources/wikiBirths";
import { fetchEntities, type Enriched } from "./sources/wikidataEntities";
import { fetchDayInfo } from "./sources/jawikiDay";
import { translateToJa } from "./sources/translate";
import { mapLimit } from "./lib/util";
import charactersSeed from "../src/data/characters.json";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "public", "data", "days");
const STATE_PATH = path.join(ROOT, "src", "data", "state.json");
const ENRICH_VERSION = "1"; // 翻訳ロジックを変えたら上げる → 旧キャッシュ破棄
const PEOPLE_PER_DAY = 24;

interface State {
  entities: Record<string, Enriched>;
  translations: Record<string, string>; // descEn -> descJa
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

async function buildPeople(month: number, day: number, state: State): Promise<Person[]> {
  const raw = await fetchBirths(month, day);
  if (raw.length === 0) return [];

  // 未キャッシュの Q-ID だけ補完。
  const qids = raw.map((r) => r.qid);
  const missing = qids.filter((q) => !(q in state.entities));
  if (missing.length > 0) {
    const fetched = await fetchEntities(missing);
    for (const [q, e] of fetched) state.entities[q] = e;
  }

  // 日本語 description が無い人物は英語 description を翻訳（任意・キャッシュ）。
  const needTranslate = raw
    .filter((r) => !state.entities[r.qid]?.descJa && r.descEn)
    .map((r) => r.descEn);
  await ensureTranslations(needTranslate, state);

  const people: Person[] = raw.map((r) => {
    const e = state.entities[r.qid] ?? { fame: 0, jaKnown: false };
    const desc = e.descJa || state.translations[r.descEn] || r.descEn;
    return {
      name: e.nameJa || r.nameEn,
      nameEn: r.nameEn,
      year: r.year,
      desc,
      photo: r.photo,
      url: r.url,
      jaKnown: e.jaKnown,
      fame: e.fame,
    };
  });

  // ランキング: 日本で知られている人を優先 → 知名度 → 写真ありを僅差で優先。
  people.sort((a, b) => {
    if (a.jaKnown !== b.jaKnown) return a.jaKnown ? -1 : 1;
    if (b.fame !== a.fame) return b.fame - a.fame;
    return (b.photo ? 1 : 0) - (a.photo ? 1 : 0);
  });
  return people.slice(0, PEOPLE_PER_DAY);
}

async function run(): Promise<void> {
  const state = readJson<State>(STATE_PATH, { entities: {}, translations: {}, enrichVersion: ENRICH_VERSION });
  if (state.enrichVersion !== ENRICH_VERSION) {
    state.translations = {};
    state.enrichVersion = ENRICH_VERSION;
  }
  state.entities ??= {};
  state.translations ??= {};

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

    let people: Person[];
    try {
      people = await buildPeople(month, day, state);
    } catch (e) {
      errs.push(`people: ${(e as Error).message}`);
      people = prev?.people ?? [];
    }

    let anniversaries: Anniversary[];
    let events: DayEvent[];
    try {
      const info = await fetchDayInfo(month, day);
      anniversaries = info.anniversaries;
      events = info.events;
    } catch (e) {
      errs.push(`jawiki: ${(e as Error).message}`);
      anniversaries = prev?.anniversaries ?? [];
      events = prev?.events ?? [];
    }

    const out: DayData = {
      date: key,
      people,
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
      console.log(`  ${key}: 有名人${people.length} / キャラ${out.characters.length} / 記念日${anniversaries.length} / できごと${events.length}`);
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
