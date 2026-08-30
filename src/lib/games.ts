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

/**
 * ジャケット画像 URL。無ければ空文字（表示側は 🎮 プレースホルダのまま）。
 * IGDB を先に見るのは、縦長サムネ専用 URL が軽く（実測 3.8KB）列の見た目も揃うため。
 * Steam も縦長の library_600x900 を使って箱の縦横比を合わせる（Steam 由来は 1日 0〜2本）。
 */
export function coverUrl(g: Game): string {
  if (g.cover) return `https://images.igdb.com/igdb/image/upload/t_cover_small/${g.cover}.jpg`;
  if (g.appid) return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.appid}/library_600x900.jpg`;
  return "";
}
