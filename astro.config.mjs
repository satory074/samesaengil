// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages のプロジェクトページ運用前提。
// カスタムドメインにする場合は base を空文字に変更すること。
const repoName = "samesaengil";
const ghUser = process.env.GH_USER ?? "satory074";

export default defineConfig({
  site: `https://${ghUser}.github.io`,
  base: `/${repoName}`,
  trailingSlash: "ignore",
  // public/robots.txt が sitemap-index.xml を指しているのに未導入で 404 だった。
  // 366 の日別ページを検索エンジンに拾わせるためにも必須。
  integrations: [sitemap()],
  vite: {
    // Tailwind v4 Vite plugin: cast to any to bridge Vite version typing mismatch
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
