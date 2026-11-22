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
  // GitHub Pages はディレクトリ URL を末尾 / 付きで返す（無しは 301）。Astro 側も「末尾 / が正」に揃える。
  // "ignore" のままだと base が "/samesaengil" のままで、sitemap にトップが
  // ".../samesaengil" と ".../samesaengil/" の 2 回載っていた（前者は 301 になる URL）。
  // ※ dev サーバでも /samesaengil/day/06-18（/ 無し）は 404 になる。末尾 / を付けて開くこと。
  trailingSlash: "always",
  // public/robots.txt が sitemap-index.xml を指している。366 の日別ページを検索エンジンに拾わせるためにも必須。
  integrations: [sitemap()],
  vite: {
    // Tailwind v4 Vite plugin: cast to any to bridge Vite version typing mismatch
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
