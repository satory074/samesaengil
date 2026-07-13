// wikitext の共通処理（複数ソースが使うのでここに集約）。

/** wikitext のリンク・テンプレート・参照・装飾を落として素のテキストに。 */
export function cleanWikitext(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "") // 単純なテンプレート（入れ子は1段のみ）
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[a|b]] -> b
    .replace(/\[\[([^\]]*)\]\]/g, "$1") // [[a]] -> a
    .replace(/'''?/g, "") // 太字・斜体
    .replace(/<[^>]+>/g, "") // 残った HTML タグ
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** 先頭の [[target|display]] / [[name]] を {title, name} に。無ければ null。 */
export function firstLink(s: string): { title: string; name: string } | null {
  const m = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(s);
  if (!m) return null;
  return { title: m[1].trim(), name: (m[2] ?? m[1]).trim() };
}

/** jawiki 記事 URL。 */
export function jaWikiUrl(title: string): string {
  return `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}
