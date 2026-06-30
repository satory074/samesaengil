// base path（/samesaengil）を意識せずに内部リンクを組むためのヘルパ。
// Astro は <a href> / <img src> 等の HTML 属性は自動で base 解決するが、
// JS で文字列を組む場面（クライアント描画・fetch パス）では本関数を必ず使う。

// import.meta.env は Vite ビルド時に注入される。tsx/jsdom テスト下では未定義なので
// オプショナルチェーンでフォールバックし、import 時に throw しないようにする。
const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/$/, "");

export function siteLink(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${base}${path}`;
}

const SITE_ORIGIN = "https://satory074.github.io";

/** base path を含む絶対 URL（OGP / 共有 URL など host が必須の場面で使う）。 */
export function absUrl(path: string): string {
  return `${SITE_ORIGIN}${siteLink(path)}`;
}
