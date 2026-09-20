// 「同じ誕生日に投稿されたニコニコ動画」セクションの切り分け（新しいデータソースは無い）。
// per-day ファイルの nicovideos は「その月日に投稿された全年ぶん」なので、
// 生年まで一致するもの（⭐）を先頭に抜き出し、残りを月日一覧として出す。
// src/lib/games.ts の exactGamesOf / withoutExactGames と同じ思想。
import type { NicoVideo } from "./types";

/** 同じ月日の中で、生まれた年まで一致するもの（＝生まれた日ちょうどに投稿）。 */
export function exactNicoOf(videos: NicoVideo[], year: number): NicoVideo[] {
  return videos.filter((v) => v.year === year);
}

/** ⭐に出したものを一覧から除く（同一セクション内の二重表示を防ぐ）。 */
export function withoutExactNico(videos: NicoVideo[], exact: NicoVideo[]): NicoVideo[] {
  if (exact.length === 0) return videos;
  const ids = new Set(exact.map((v) => v.id));
  return videos.filter((v) => !ids.has(v.id));
}

/** 動画ページ URL。per-day ファイルは URL ではなく ID を持つので、ここで組み立てる（types.ts 参照）。 */
export function nicoWatchUrl(v: NicoVideo): string {
  return v.id ? `https://www.nicovideo.jp/watch/${encodeURIComponent(v.id)}` : "";
}

/**
 * サムネイル URL。thumb（トークン）が無ければ ID の数字部が既定形。
 * トークンの先頭（"." より前）がそのままディレクトリ名になる——so 系はディレクトリ番号が
 * ID と一致しないため、トークン側からディレクトリを取る必要がある。
 * 読み込みに失敗したら表示側は 📺 プレースホルダに戻る（onerror）。
 */
export function nicoThumbUrl(v: NicoVideo): string {
  const token = v.thumb || v.id.replace(/^[a-z]+/i, "");
  if (!token) return "";
  return `https://nicovideo.cdn.nimg.jp/thumbnails/${token.split(".")[0]}/${token}`;
}

/** 再生数の表示（データは万単位で持っている。最大でも 3143万なのでカンマは要らない）。 */
export function viewsLabel(man: number): string {
  return `${man}万再生`;
}
