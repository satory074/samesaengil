// 「同じ誕生日に発売されたゲーム」セクションの切り分け（新しいデータソースは無い）。
// per-day ファイルの games は「その月日に発売された全年ぶん」なので、
// 生年まで一致するもの（⭐）を先頭に抜き出し、残りを月日一覧として出す。
// peers.ts の exactMatchesOf / withoutExact と同じ思想。
import type { Game } from "./types";

/** 同じ月日の中で、生まれた年まで一致するもの（＝生まれた日ちょうどに発売）。 */
export function exactGamesOf(games: Game[], year: number): Game[] {
  return games.filter((g) => g.year === year);
}

/** ⭐に出したものを一覧から除く（同一セクション内の二重表示を防ぐ）。 */
export function withoutExactGames(games: Game[], exact: Game[]): Game[] {
  if (exact.length === 0) return games;
  const keys = new Set(exact.map(gameKey));
  return games.filter((g) => !keys.has(gameKey(g)));
}

function gameKey(g: Game): string {
  return `${g.year}|${g.name}|${g.platform}`;
}

/**
 * 行のリンク先。jawiki 記事が最優先で、無ければ Steam ストア、どちらも無ければ空（非リンク）。
 * per-day ファイルは URL ではなく記事タイトル／appid を持つので、ここで組み立てる（types.ts 参照）。
 */
export function gameLink(g: Game): string {
  if (g.title) return `https://ja.wikipedia.org/wiki/${encodeURIComponent(g.title)}`;
  if (g.appid) return `https://store.steampowered.com/app/${g.appid}/`;
  return "";
}
