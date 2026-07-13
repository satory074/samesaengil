// トップ（および ?d= 付きの共有 URL）の OG 画像。
// 静的ホスティングではクエリ毎に OG を差し替えられないので、ここは日付なしの汎用カード。
// これが無いと og:image が favicon.svg のままになり、X ではカードが出ない。
import type { APIRoute } from "astro";
import { renderOgCard } from "@/lib/og";

export const GET: APIRoute = async () => {
  const png = await renderOgCard("同じ誕生日", "有名人 キャラ 記念日");
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
