// 第三者サイトの HTML をパースする取込スクリプト共通の小道具
// （fanwebDay.ts / kinenbiDay.ts で共有）。

/** HTML エンティティ（名前つき＋数値参照）を素の文字へ。 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // & は最後に（二重デコード防止）
}

/** 残った HTML タグを落として decode・空白正規化・trim。 */
export function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
