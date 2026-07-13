// 日別 OG 画像（1200x630 PNG）を 366 枚、ビルド時に生成して dist に出す。
// PNG はコミットしない（366×~76KB＝28MB。.git を太らせない）＝ここで毎回作る。
import fs from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { allDays, dayKeyOf, dayLabel, parseDayKey } from "@/lib/days";
import { renderOgCard } from "@/lib/og";
import type { DayData } from "@/lib/types";

export function getStaticPaths() {
  return allDays().map((md) => ({ params: { md: dayKeyOf(md) } }));
}

export const GET: APIRoute = async ({ params }) => {
  const md = parseDayKey(params.md!)!;
  const key = dayKeyOf(md);
  const day = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "public", "data", "days", `${key}.json`), "utf8"),
  ) as DayData;

  const png = await renderOgCard(
    `${dayLabel(md)}生まれ`,
    `有名人 ${day.people.length}人 ・ キャラ ${day.characters.length}件`,
  );
  return new Response(png, { headers: { "Content-Type": "image/png" } });
};
