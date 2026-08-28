// 366日ぶんの「誕生日データ」を生成して public/data/days/MM-DD.json に書き出す。
// ソース: 日本語版Wikipedia「M月D日」の誕生日節（人物リスト＋顔写真）+ 閲覧数(pageviews, 並び替え用の人気のみ) + 静的キャラJSON。
// 設計: ソース毎 try/catch、失敗時は前回ファイルへフォールバック（1ソース/1日が落ちても全体を壊さない）。
//
// 実行:
//   npm run aggregate            … 全366日
//   npm run aggregate 03-15      … 指定日のみ（argv）
//   ONLY_DAYS=03-15,07-04 npm run aggregate
//   CHARS_ONLY=1 npm run aggregate  … Wikipedia を叩かず characters だけ差し替え（キャッシュ済みの人気で並べる）
//   PHOTOS_ONLY=1 npm run aggregate … 日ページを叩かず、写真の無い人だけ外部ソースで補完して photo を差し替え
//   KINENBI_ONLY=1 npm run aggregate … Wikipedia を叩かず kinenbi（協会認定記念日）だけ差し替え
//   GAMES_ONLY=1 npm run aggregate  … Wikipedia を叩かず games（発売されたゲーム）だけ差し替え
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Anniversary, Character, DayData, DayEvent, Game, Person } from "../src/lib/types";
import { fetchDayInfo, type JaRawBirth } from "./sources/jawikiDay";
import { kinenbiUrl, splitKinenbiName, type KinenbiEntry } from "./sources/kinenbiDay";
import { mapLimit } from "./lib/util";
import {
  emptyPhotoStats,
  ensurePages,
  ensurePageviews,
  ensurePhotos,
  readState,
  resolveWorkFame,
  writeState,
  type PhotoCandidate,
  type PhotoStats,
  type State,
} from "./lib/state";
import { photoUrlLooksLikePortrait } from "./lib/portrait";
import { allDays } from "../src/lib/days";
import charactersSeed from "../src/data/characters.json";
import fanwebSeed from "../src/data/characters-fanweb.json";

const ROOT = process.cwd();
const DAYS_DIR = path.join(ROOT, "public", "data", "days");

/**
 * 外部ソースで顔写真を探す下限の人気（年間閲覧数）。
 * 写真なしは 5 万人おり全員に TMDB を叩くのは重いので、実際に一覧の上の方に出てくる層に絞る。
 * PHOTO_MIN_FAME=0 で全員が対象。
 */
const PHOTO_MIN_FAME = Number(process.env.PHOTO_MIN_FAME ?? 5000);

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

/**
 * 日本記念日協会の取込 JSON（src/data/kinenbi.json、コミット済み）を MM-DD -> Anniversary[] に。
 * 実行時 API なし。無ければ空（初回取込前でも aggregate は壊れない）。
 */
function readKinenbiMap(): Map<string, Anniversary[]> {
  const rows = readJson<(KinenbiEntry & { month: number; day: number })[]>(
    path.join(ROOT, "src", "data", "kinenbi.json"),
    [],
  );
  if (rows.length === 0) {
    console.warn("[aggregate] src/data/kinenbi.json が空です。先に npm run import:kinenbi を実行してください。");
  }
  const map = new Map<string, Anniversary[]>();
  for (const r of rows) {
    const key = `${pad(r.month)}-${pad(r.day)}`;
    const arr = map.get(key) ?? [];
    arr.push({ ...splitKinenbiName(r.name), url: kinenbiUrl(r) });
    map.set(key, arr);
  }
  return map;
}

/** 発売されたゲームの取込 JSON（src/data/games.json、コミット済み）の 1 行。 */
type GameSeedRow = {
  name: string;
  title?: string;
  year: number;
  month: number;
  day: number;
  platform: string;
  appid?: number;
};

function readGameSeeds(): GameSeedRow[] {
  const rows = readJson<GameSeedRow[]>(path.join(ROOT, "src", "data", "games.json"), []);
  if (rows.length === 0) {
    console.warn("[aggregate] src/data/games.json が空です。先に npm run import:games を実行してください。");
  }
  return rows;
}

/** ゲームの人気解決に使う jawiki 記事タイトル（ユニーク）。 */
function allGameTitles(seeds: GameSeedRow[]): string[] {
  return [...new Set(seeds.map((g) => g.title).filter((t): t is string => Boolean(t)))];
}

/** 同日同名をまとめるためのキー（記号と空白の揺れを吸収）。 */
function gameKey(g: GameSeedRow): string {
  return `${g.year}|${g.name.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "")}`;
}

/**
 * 取込 JSON を MM-DD -> Game[] にまとめる。実行時 API なし。
 * 同じ日に同名が複数機種で出ていれば 1 件にして機種名を連結する
 * （『クライマキナ』が PS4／PS5／Switch で 3 行になるのを防ぐ）。
 * 並びは人物・キャラと同じ規範で 人気(閲覧数)降順 → 年の新しい順 → 名前。
 */
function buildGameMap(seeds: GameSeedRow[], fame: Map<string, number>): Map<string, Game[]> {
  const byDay = new Map<string, Map<string, { seed: GameSeedRow; platforms: string[] }>>();
  for (const g of seeds) {
    if (!g.name || !g.year || !g.month || !g.day) continue;
    const key = `${pad(g.month)}-${pad(g.day)}`;
    const day = byDay.get(key) ?? new Map();
    byDay.set(key, day);
    const k = gameKey(g);
    const hit = day.get(k);
    if (!hit) {
      day.set(k, { seed: g, platforms: [g.platform] });
      continue;
    }
    if (!hit.platforms.includes(g.platform)) hit.platforms.push(g.platform);
    // jawiki 記事へのリンクは、持っている行があればそれを採る。
    if (!hit.seed.title && g.title) hit.seed = { ...hit.seed, title: g.title };
    if (!hit.seed.appid && g.appid) hit.seed = { ...hit.seed, appid: g.appid };
  }

  const map = new Map<string, Game[]>();
  for (const [key, day] of byDay) {
    // 人気(閲覧数)降順 → 年の新しい順 → 名前。1日 最大数百件で初期表示は先頭30件なので並びが効く。
    const ranked = [...day.values()]
      .map(({ seed, platforms }) => ({ seed, platforms, fame: fame.get(seed.title ?? "") ?? 0 }))
      .sort((a, b) => {
        if (b.fame !== a.fame) return b.fame - a.fame;
        if (b.seed.year !== a.seed.year) return b.seed.year - a.seed.year;
        return a.seed.name.localeCompare(b.seed.name, "ja");
      });
    map.set(
      key,
      ranked.map<Game>(({ seed, platforms }) => ({
        name: seed.name,
        year: seed.year,
        platform: platforms.join("・"),
        // URL ではなく記事タイトル／appid を持つ（per-day を膨らませないため。types.ts の Game 参照）。
        ...(seed.title ? { title: seed.title } : {}),
        ...(seed.appid ? { appid: seed.appid } : {}),
      })),
    );
  }
  return map;
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
/** AniList 由来のキャラ画像キャッシュ（src/data/anilist.json、コミット済み）。作品名 → キャラ名 → 画像URL。 */
function readCharImages(): Map<string, Record<string, string>> {
  const cache = readJson<{ works?: Record<string, { chars?: Record<string, string> }> }>(
    path.join(ROOT, "src", "data", "anilist.json"),
    {},
  );
  const map = new Map<string, Record<string, string>>();
  for (const [work, e] of Object.entries(cache.works ?? {})) {
    if (e.chars && Object.keys(e.chars).length > 0) map.set(work, e.chars);
  }
  return map;
}

function buildCharacterMap(fame: Map<string, number>): Map<string, Character[]> {
  const map = new Map<string, Character[]>();
  const seen = new Map<string, Set<string>>(); // key -> その日の登録済み name 集合
  const images = readCharImages(); // 実行時 API なし（コミット済みキャッシュを読むだけ）

  const add = (c: CharSeedRow, color: string | undefined): void => {
    const key = `${pad(c.month)}-${pad(c.day)}`;
    const names = seen.get(key) ?? new Set<string>();
    if (names.has(c.name)) return; // 同日同名は先勝ち（curated 優先）
    names.add(c.name);
    seen.set(key, names);
    const arr = map.get(key) ?? [];
    const image = images.get(c.work)?.[c.name];
    arr.push({ name: c.name, work: c.work, url: c.url, color, ...(image ? { image } : {}) });
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

/**
 * 日本語版「誕生日」1 行 → Person（＋dedup 用の正規化タイトル）。fame は ja Wikipedia の年間閲覧数。
 * 写真は jawiki の pageimages が最優先で、無ければ外部ソース（state.photos）で補完したもの。
 */
function personFromJa(b: JaRawBirth, state: State): { person: Person; canon: string } {
  const cached = state.pages[b.title];
  const meta = cached ?? {};
  const canon = meta.title ?? b.title; // リダイレクト解決後の実タイトル
  // 解決を試みた結果いずれの記事にも当たらなかった（負キャッシュ）なら、リンクを張らない。
  // 誕生日節には記事が無い人（赤リンク）も載っており、URL を組むと 404 に飛ばしてしまう。
  const exists = cached === undefined || Boolean(meta.title);
  return {
    canon,
    person: {
      name: b.name,
      nameEn: "",
      year: b.year ?? 0,
      desc: b.descJa,
      photo: meta.photo || (state.photos[b.title]?.url ?? ""),
      url: exists ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(b.title)}` : "",
      jaKnown: true,
      fame: state.views[canon] ?? 0, // 年間閲覧数＝日本での人気指標
    },
  };
}

/**
 * 日本語版Wikipedia「誕生日」節から人物一覧＋動物一覧を構築（人物リストは日本語版のみ）。
 * 名前・肩書きは日本語リスト由来、並び替えは ja Wikipedia の閲覧数(=人気)。
 * 写真は ja pageimages → 取れない人だけ外部ソース（TMDB / Wikidata P18 / Spotify）へフォールバック。
 */
async function buildPeopleAndAnimals(
  jaBirths: JaRawBirth[],
  jaAnimals: JaRawBirth[],
  state: State,
  photoStats: PhotoStats,
): Promise<{ people: Person[]; animals: Person[] }> {
  const all = [...jaBirths, ...jaAnimals];
  // 1) ja タイトルを {photo, 正規化タイトル} に解決（キャッシュ）。
  await ensurePages(all.map((b) => b.title), state);
  // 2) 正規化タイトルの閲覧数を取得（人気指標・キャッシュ）。
  await ensurePageviews(all.map((b) => state.pages[b.title]?.title ?? b.title), state);

  // 3) jawiki に写真が無い人を外部ソースで補完（fame が確定してからでないと候補を絞れないのでこの順）。
  const cands: PhotoCandidate[] = [];
  for (const b of all) {
    const meta = state.pages[b.title];
    if (!meta?.title || meta.photo) continue; // 記事が無い人・すでに写真がある人は対象外
    const fame = state.views[meta.title] ?? 0;
    if (fame < PHOTO_MIN_FAME) continue;
    cands.push({ key: b.title, name: b.name, qid: meta.qid });
  }
  await ensurePhotos(cands, state, photoStats);

  // 4) 人物を構築。正規化タイトルで一意化。
  const byKey = new Map<string, Person>();
  for (const b of jaBirths) {
    const { person, canon } = personFromJa(b, state);
    if (!byKey.has(canon)) byKey.set(canon, person);
  }
  const people = [...byKey.values()].filter((p) => !isYearLike(p.name));
  rankPeople(people);

  // 5) 動物（人物以外）。
  const animals = jaAnimals.map((b) => personFromJa(b, state).person).filter((p) => !isYearLike(p.name));
  rankPeople(animals);

  return { people, animals };
}

/** 写真の解決結果を 1 行で報告（サイレント破損の検知）。 */
function logPhotoStats(stats: PhotoStats): void {
  const found = stats.p18 + stats.commons;
  if (found + stats.missing + stats.failed === 0) return;
  console.log(
    `[aggregate] 顔写真の補完: 解決${found}（P18 ${stats.p18} / Commons ${stats.commons}）` +
      ` / 見つからず${stats.missing} / 失敗${stats.failed}`,
  );
}

/** Person.url（`https://ja.wikipedia.org/wiki/<encoded>`）から state のキー（jawiki 要求タイトル）を復元。 */
function jaTitleFromUrl(url: string): string {
  const seg = url.split("/wiki/")[1];
  if (!seg) return "";
  try {
    return decodeURIComponent(seg);
  } catch {
    return "";
  }
}

/**
 * 高速適用パス: jawiki の「M月D日」ページを一切叩かず、既存 per-day ファイルの
 * **写真が無い人だけ**を外部ソースで補完して photo を差し替える。
 *
 * 全366日ぶんの候補を先に集めてから 1 回で解決するので、Wikidata P18 の 50 件バッチが効く
 * （日ごとに呼ぶ通常パスより API コール数が少ない）。写真は並び順のタイブレークなので最後に並べ直す。
 */
async function runPhotosOnly(state: State, days: { month: number; day: number }[]): Promise<void> {
  const stats = emptyPhotoStats();
  const files = new Map<string, DayData>();
  const cands: PhotoCandidate[] = [];
  let missingFiles = 0;
  let purged = 0;

  // 既存 JSON の写真も検品する。生成済みの per-day には「顔写真でない画像」（Gthumb.svg＝画像なし
  // アイコン、グループのロゴ等）が入っており、state 側のマイグレーションだけでは JSON に残るため。
  const keepPhoto = (p: Person): string => {
    if (!p.photo) return "";
    if (photoUrlLooksLikePortrait(p.photo)) return p.photo;
    purged++;
    return ""; // 顔でない画像は捨て、外部ソースの補完対象に回す
  };

  for (const { month, day } of days) {
    const key = `${pad(month)}-${pad(day)}`;
    const prev = readJson<DayData | null>(path.join(DAYS_DIR, `${key}.json`), null);
    if (!prev) {
      missingFiles++;
      continue; // ファイルが無い日はスキップ（まず通常 aggregate が必要）
    }
    files.set(key, prev);
    for (const p of [...prev.people, ...prev.animals]) {
      if (keepPhoto(p) || p.fame < PHOTO_MIN_FAME) continue;
      const title = jaTitleFromUrl(p.url);
      if (!title) continue;
      cands.push({ key: title, name: p.name, qid: state.pages[title]?.qid });
    }
  }
  purged = 0; // 上のループは候補選定のための試算。実際の削除数は下の書き戻しで数える。

  console.log(`[aggregate] PHOTOS_ONLY: ${files.size}日 / 写真なし${cands.length}人を外部ソースで補完します…`);
  await ensurePhotos(cands, state, stats);
  writeState(state);
  logPhotoStats(stats);

  let updated = 0;
  let filled = 0;
  for (const [key, prev] of files) {
    const fix = (p: Person): Person => {
      const kept = keepPhoto(p);
      if (kept) return p;
      const url = state.photos[jaTitleFromUrl(p.url)]?.url ?? "";
      if (url) filled++;
      return { ...p, photo: url }; // 見つからなければ ""（＝イニシャルのプレースホルダ）
    };
    const people = prev.people.map(fix);
    const animals = prev.animals.map(fix);
    rankPeople(people); // 写真ありは fame 同着時のタイブレーク＝埋まったぶん順序が動きうる
    rankPeople(animals);
    writeJson(path.join(DAYS_DIR, `${key}.json`), {
      ...prev,
      people,
      animals,
      updatedAt: new Date().toISOString(),
    });
    updated++;
  }
  console.log(
    `[aggregate] PHOTOS_ONLY 完了: ${updated}日を更新（写真を新たに${filled}人ぶん追加 / 顔でない画像を${purged}件除去）` +
      ` / 欠落${missingFiles}日`,
  );
}

async function run(): Promise<void> {
  const state = readState();
  const charsOnly = Boolean(process.env.CHARS_ONLY);

  // 写真だけの補完パス（キャラの人気解決も日ページ取得も不要なので最初に分岐する）。
  if (process.env.PHOTOS_ONLY) {
    await runPhotosOnly(state, selectDays());
    return;
  }

  // 高速適用パス: Wikipedia を叩かず、既存 per-day ファイルの kinenbi（協会認定記念日）だけ差し替える。
  // import:kinenbi の後、全366日へ数秒で反映するための経路（CHARS_ONLY と同型・冪等）。
  if (process.env.KINENBI_ONLY) {
    const kinenbiMap = readKinenbiMap();
    let updated = 0;
    let missing = 0;
    for (const { month, day } of selectDays()) {
      const key = `${pad(month)}-${pad(day)}`;
      const filePath = path.join(DAYS_DIR, `${key}.json`);
      const prev = readJson<DayData | null>(filePath, null);
      if (!prev) {
        missing++;
        continue; // ファイルが無い日はスキップ（まず通常 aggregate が必要）
      }
      writeJson(filePath, { ...prev, kinenbi: kinenbiMap.get(key) ?? [], updatedAt: new Date().toISOString() });
      updated++;
    }
    console.log(`[aggregate] KINENBI_ONLY 完了: 更新${updated} / 欠落${missing}日`);
    return;
  }

  // 高速適用パス: Wikipedia を叩かず、既存 per-day ファイルの games だけ差し替える。
  // import:games / rank:games の後、全366日へ数秒で反映するための経路（KINENBI_ONLY と同型・冪等）。
  if (process.env.GAMES_ONLY) {
    const seeds = readGameSeeds();
    const gameFame = await resolveWorkFame(allGameTitles(seeds), state, true); // キャッシュ済みの人気だけ使う
    const gameMap = buildGameMap(seeds, gameFame);
    let updated = 0;
    let missing = 0;
    for (const { month, day } of selectDays()) {
      const key = `${pad(month)}-${pad(day)}`;
      const filePath = path.join(DAYS_DIR, `${key}.json`);
      const prev = readJson<DayData | null>(filePath, null);
      if (!prev) {
        missing++;
        continue; // ファイルが無い日はスキップ（まず通常 aggregate が必要）
      }
      writeJson(filePath, { ...prev, games: gameMap.get(key) ?? [], updatedAt: new Date().toISOString() });
      updated++;
    }
    console.log(`[aggregate] GAMES_ONLY 完了: 更新${updated} / 欠落${missing}日`);
    return;
  }

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

  const kinenbiMap = readKinenbiMap(); // コミット済み JSON を読むだけ（実行時 API なし）

  // ゲームも同じく取込済み JSON を読むだけ。並び替え用の人気はキャラの作品と同じ経路・同じキャッシュ。
  const gameSeeds = readGameSeeds();
  const gameFame = await resolveWorkFame(allGameTitles(gameSeeds), state);
  const gameMap = buildGameMap(gameSeeds, gameFame);
  console.log(`[aggregate] ゲーム: ${gameSeeds.length}本 / 人気解決 ${[...gameFame.values()].filter((v) => v > 0).length}件`);

  const single = days.length === 1;
  // 日単位で並列（Wikimedia への礼儀として控えめ）。AGG_CONCURRENCY で上書き可。
  const concurrency = single ? 1 : Number(process.env.AGG_CONCURRENCY ?? 3);
  console.log(`[aggregate] ${days.length}日ぶんを生成します（並列${concurrency}）…`);

  let ok = 0;
  let withErrors = 0;
  let done = 0;
  const photoStats = emptyPhotoStats();

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
        ({ people, animals } = await buildPeopleAndAnimals(jaBirths, jaAnimals, state, photoStats));
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
      // ローカルのコミット済みファイル由来なので prev フォールバック不要（継続性は import:kinenbi 側が担保）。
      kinenbi: kinenbiMap.get(key) ?? [],
      events,
      updatedAt: new Date().toISOString(),
      games: gameMap.get(key) ?? [],
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
      console.log(`  ${key}: 有名人${people.length} / 動物${animals.length} / キャラ${out.characters.length} / 記念日${anniversaries.length}+協会${out.kinenbi.length} / できごと${events.length} / ゲーム${out.games.length}`);
    } else if (done % 20 === 0) {
      console.log(`  …${done}/${days.length}`);
      writeState(state); // 途中保存（落ちてもキャッシュが残る）
    }
  });

  writeState(state);
  logPhotoStats(photoStats);
  console.log(`[aggregate] 完了: 成功${ok} / 警告${withErrors} / 計${days.length}日`);
}

run().catch((e) => {
  console.error("[aggregate] 致命的エラー:", e);
  process.exit(1);
});
