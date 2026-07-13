// 横断キャッシュ（src/data/state.json）と、そこを経由する jawiki の解決処理。
// aggregate.ts（人物の写真・人気）と rankWorks.ts（作品の人気）で共有する。
//
// キー空間はどちらも「日本語版 Wikipedia の記事タイトル」なので、人物も作品も同じ 2 つの表に同居できる:
//   pages: 要求タイトル -> {qid, photo, title(リダイレクト解決後)}（記事が無い場合は {} ＝負キャッシュ）
//   views: 正規化後タイトル -> 直近12か月の閲覧数（＝日本での人気指標）
import fs from "node:fs";
import path from "node:path";
import { fetchPageMeta, type PageMeta } from "../sources/jawikiPageMeta";
import { fetchPageviews, last12Months } from "../sources/jawikiPageviews";

export interface State {
  pages: Record<string, PageMeta>;
  views: Record<string, number>;
}

export const STATE_PATH = path.join(process.cwd(), "src", "data", "state.json");

/** 閲覧数の集計期間（実行時に直近12か月を確定）。 */
const PV_WINDOW = last12Months(new Date());

export function readState(): State {
  let state: State;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    state = { pages: {}, views: {} };
  }
  state.pages ??= {};
  state.views ??= {};
  // 旧スキーマの未使用キャッシュ（Wikidata entities 等）を捨てて state.json を軽く保つ。
  const legacy = state as unknown as Record<string, unknown>;
  delete legacy.entities;
  delete legacy.translations;
  delete legacy.enrichVersion;
  return state;
}

export function writeState(state: State): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 0) + "\n");
}

/** ja タイトル群を {qid,photo,正規化タイトル} に解決（state.pages にキャッシュ、負キャッシュ込み）。 */
export async function ensurePages(titles: string[], state: State): Promise<void> {
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
