// 検索エンジン向けのページ情報（title / description / JSON-LD）を組み立てる純関数。
// JSON-LD は画面に出ている内容だけを書く（人物一覧などを特別なマークアップにはしない）。
import { absUrl } from "./url";

export const SITE_NAME = "Same Saengil";
export const SITE_TITLE = "Same Saengil — 同じ誕生日、なにがある？";
export const SITE_DESCRIPTION =
  "生年月日を入れるだけ。同じ誕生日の有名人・キャラ・記念日・星座まで、あなたの誕生日まるわかり。飲み会のネタにどうぞ。";

/** 作者。この @id は satory074.com 側で Person として定義されている（全アプリ共通）。 */
const AUTHOR = {
  "@type": "Person",
  "@id": "https://satory074.com/#person",
  name: "satory074",
  url: "https://satory074.com/",
} as const;

const WEBSITE_ID = `${absUrl("/")}#website`;

/** トップ（/）の JSON-LD。 */
export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: absUrl("/"),
    description: SITE_DESCRIPTION,
    inLanguage: "ja",
    author: AUTHOR,
  };
}

/** 下層ページ（/day/ と /day/MM-DD/）の JSON-LD。path は base 相対・末尾 /。 */
export function webPageJsonLd(p: {
  type?: "WebPage" | "CollectionPage";
  name: string;
  path: string;
  description: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": p.type ?? "WebPage",
    name: p.name,
    url: absUrl(p.path),
    description: p.description,
    inLanguage: "ja",
    isPartOf: { "@id": WEBSITE_ID },
    author: AUTHOR,
  };
}

/** <script type="application/ld+json"> に流す文字列。"</script>" で閉じられないよう < を逃がす。 */
export function jsonLdText(ld: Record<string, unknown>): string {
  return JSON.stringify(ld).replace(/</g, "\\u003c");
}
