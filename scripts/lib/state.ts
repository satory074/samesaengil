// 横断キャッシュ（src/data/state.json）と、そこを経由する jawiki の解決処理。
// aggregate.ts（人物の写真・人気）と rankWorks.ts（作品の人気）で共有する。
//
// キー空間はどれも「日本語版 Wikipedia の記事タイトル」なので、人物も作品も同じ表に同居できる:
//   pages:  要求タイトル -> {qid, photo, title(リダイレクト解決後)}（記事が無い場合は {} ＝負キャッシュ）
//   views:  正規化後タイトル -> 直近12か月の閲覧数（＝日本での人気指標）
//   photos: 要求タイトル -> jawiki に写真が無かった人の**外部ソース由来の顔写真**（"" ＝全段外れた負キャッシュ）
import fs from "node:fs";
import path from "node:path";
import { fetchPageMeta, type PageMeta } from "../sources/jawikiPageMeta";
import { fetchPageviews, last12Months } from "../sources/jawikiPageviews";
import { photoUrlLooksLikePortrait } from "./portrait";
import {
  emptyPhotoStats,
  resolvePhotos,
  type PhotoCandidate,
  type PhotoSrc,
  type PhotoStats,
} from "../sources/photos";

/** 外部ソースで解決した顔写真。url:"" は「全段試して見つからなかった」の負キャッシュ。 */
export interface PhotoEntry {
  url: string;
  src?: PhotoSrc;
  /** 解決したときのカスケードの版。PHOTO_VERSION を上げると全件やり直せる。 */
  v: number;
}

export interface State {
  pages: Record<string, PageMeta>;
  views: Record<string, number>;
  photos: Record<string, PhotoEntry>;
  /** state.json 自体のスキーマ版（1回だけのマイグレーション用）。 */
  schemaV?: number;
}

export const STATE_PATH = path.join(process.cwd(), "src", "data", "state.json");

/**
 * 顔写真カスケードの版。ソースや照合ロジックを変えたらこれを上げる
 * → 既存の解決結果・負キャッシュを無視して引き直す（spotify.json の SPOTIFY_RECHECK と同じ発想）。
 */
const PHOTO_VERSION = 3;

/** state.json のスキーマ版。上げると readState が対応するマイグレーションを 1 回だけ実行する。 */
const SCHEMA_VERSION = 2;

/** 閲覧数の集計期間（実行時に直近12か月を確定）。 */
const PV_WINDOW = last12Months(new Date());

export function readState(): State {
  let state: State;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    state = { pages: {}, views: {}, photos: {} };
  }
  state.pages ??= {};
  state.views ??= {};
  state.photos ??= {};
  // 旧スキーマの未使用キャッシュ（Wikidata entities 等）を捨てて state.json を軽く保つ。
  const legacy = state as unknown as Record<string, unknown>;
  delete legacy.entities;
  delete legacy.translations;
  delete legacy.enrichVersion;

  if ((state.schemaV ?? 0) < 1) {
    // v1: 赤リンク（存在しない記事）が「解決済み」として固着していたのを捨てる。
    // jawikiPageMeta が missing フラグを見ていなかった頃、MediaWiki が負の pageid で返す
    // 存在しないページも {title} として保存されていた（実測 3,640 件、うち 3,516 件は閲覧数 0）。
    // 破棄すれば次回 ensurePages が引き直し、修正後のパーサが正しく {} 負キャッシュにする。
    let dropped = 0;
    for (const [t, m] of Object.entries(state.pages)) {
      if (m.title && !m.qid) {
        delete state.pages[t];
        dropped++;
      }
    }
    if (dropped) console.log(`[state] v1 マイグレーション: 赤リンク疑いの ${dropped} 件を破棄（次回引き直し）`);
  }

  if ((state.schemaV ?? 0) < 2) {
    // v2: jawiki pageimages から拾った「顔写真でない画像」を捨てる（Gthumb.svg＝画像なしアイコン、
    // グループのロゴ、墓、家紋など。実測 1,163/39,063）。photo を消すだけでよい——ensurePages は
    // 正規化タイトルがあれば引き直さないので、この人は「写真なし」として外部ソースの補完対象になる。
    let dropped = 0;
    for (const m of Object.values(state.pages)) {
      if (m.photo && !photoUrlLooksLikePortrait(m.photo)) {
        delete m.photo;
        dropped++;
      }
    }
    if (dropped) console.log(`[state] v2 マイグレーション: 顔写真でない画像 ${dropped} 件を破棄（外部ソースで補完し直す）`);
  }
  state.schemaV = SCHEMA_VERSION;
  return state;
}

export function writeState(state: State): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 0) + "\n");
}

/**
 * ja タイトル群を {qid,photo,正規化タイトル} に解決（state.pages にキャッシュ、負キャッシュ込み）。
 *
 * PHOTO_RECHECK=1 のときは「記事はあるが写真なし」のエントリも引き直す。
 * 通常は m.title があれば最新扱いで二度と引かないので、jawiki が後から画像を足しても
 * 永久に反映されなかった（この脱出口が無いと写真の網羅率はフル実行しても改善しない）。
 */
export async function ensurePages(titles: string[], state: State): Promise<void> {
  const recheck = Boolean(process.env.PHOTO_RECHECK);
  const need = [...new Set(titles.filter(Boolean))].filter((t) => {
    const m = state.pages[t];
    if (m === undefined) return true; // 未取得
    if (recheck && m.title && !m.photo) return true; // 写真なしを引き直す（jawiki が後から足した分）
    if (m.title) return false; // 正規化タイトルあり＝最新
    return Boolean(m.qid || m.photo); // 旧キャッシュ（正規化タイトル欠落）は再取得。{} は負キャッシュで据置
  });
  if (need.length === 0) return;
  const fetched = await fetchPageMeta(need);
  for (const t of need) state.pages[t] = fetched.get(t) ?? {}; // 無ければ {} で負キャッシュ
}

/**
 * jawiki に顔写真が無かった人物を、外部ソース（TMDB / Wikidata P18 / Commons / Spotify）で補完する。
 * 解決済み・負キャッシュ済み（同じ PHOTO_VERSION）の人は叩かない。PHOTO_RECHECK=1 で負キャッシュも引き直す。
 *
 * 候補の絞り込み（fame の下限など）は呼び出し側の責任。ここは渡されたぶんだけ解決する。
 */
export async function ensurePhotos(
  cands: PhotoCandidate[],
  state: State,
  stats: PhotoStats,
): Promise<void> {
  const recheck = Boolean(process.env.PHOTO_RECHECK);
  const seen = new Set<string>();
  const need = cands.filter((c) => {
    if (!c.key || seen.has(c.key)) return false;
    const e = state.photos[c.key];
    if (e === undefined) {
      seen.add(c.key);
      return true;
    }
    if (e.v !== PHOTO_VERSION) {
      seen.add(c.key);
      return true; // カスケードの版が上がった＝引き直す
    }
    if (e.url === "" && recheck) {
      seen.add(c.key);
      return true; // 負キャッシュの再挑戦
    }
    return false;
  });
  if (need.length === 0) return;

  const { hits, missing } = await resolvePhotos(need, stats);
  for (const [key, hit] of hits) state.photos[key] = { url: hit.url, src: hit.src, v: PHOTO_VERSION };
  for (const key of missing) state.photos[key] = { url: "", v: PHOTO_VERSION }; // 全段外れた＝負キャッシュ
}

/** state に貯まっている外部写真（無ければ ""）。 */
export function photoFor(title: string, state: State): string {
  return state.photos[title]?.url ?? "";
}

export { emptyPhotoStats, type PhotoCandidate, type PhotoStats };

/** 正規化タイトル群の未キャッシュ分だけ閲覧数を取得（state.views にキャッシュ）。 */
export async function ensurePageviews(titles: string[], state: State): Promise<void> {
  const need = [...new Set(titles.filter(Boolean))].filter((t) => !(t in state.views));
  if (need.length === 0) return;
  const fetched = await fetchPageviews(need, PV_WINDOW.start, PV_WINDOW.end);
  for (const t of need) state.views[t] = fetched.get(t) ?? 0;
}

/**
 * 作品名 → 人気（作品記事の年間閲覧数）。キャラの並び替えに使う。
 * jawiki に記事が無い作品は 0（＝一覧の後ろへ）。
 * cacheOnly のときは取得せず、キャッシュ済みの分だけ返す（CHARS_ONLY 用）。
 */
export async function resolveWorkFame(
  works: string[],
  state: State,
  cacheOnly = false,
): Promise<Map<string, number>> {
  const uniq = [...new Set(works.filter(Boolean))];
  if (!cacheOnly) {
    await ensurePages(uniq, state);
    await ensurePageviews(
      uniq.map((w) => state.pages[w]?.title ?? ""),
      state,
    );
  }
  const fame = new Map<string, number>();
  for (const w of uniq) {
    const canon = state.pages[w]?.title;
    fame.set(w, canon ? (state.views[canon] ?? 0) : 0);
  }
  return fame;
}
