// OG カード（1200x630 PNG）の生成。ビルド時のみ実行（satori/resvg は Node 専用）。
//
// 画像に **人名は入れない**（固定文言＋日付＋件数だけ）。字形が限定されるのでフォントは
// 41KB のサブセットで足り、「誰を載せるか」問題も起きない。
// 文言を変えるときは scripts/buildFontSubset.ts の OG_GLYPHS も必ず更新すること
// （サブセットに無い字は豆腐になる）。
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const FONT = fs.readFileSync(path.join(process.cwd(), "src", "assets", "fonts", "NotoSansJP-Subset.ttf"));

const PINK = "#ff4f9a";
const PURPLE = "#8b5cf6";

/** satori は JSX でなくオブジェクトでも受ける（JSX 設定を増やさないためこちらを使う）。 */
type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

/** 大見出し＋サブ見出しのカードを PNG で返す。 */
export async function renderOgCard(headline: string, sub: string): Promise<Uint8Array> {
  const markup = el(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#1a1420",
      backgroundImage: `linear-gradient(135deg, ${PINK} 0%, ${PURPLE} 100%)`,
      fontFamily: "NotoSansJP",
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: 1080,
          height: 510,
          borderRadius: 40,
          backgroundColor: "#ffffff",
        },
        [
          el("div", { display: "flex", fontSize: 100, color: "#2c2435", letterSpacing: -2 }, headline),
          el("div", { display: "flex", fontSize: 42, color: PURPLE, marginTop: 24 }, sub),
          el("div", { display: "flex", fontSize: 30, color: "#9a8fa6", marginTop: 40 }, "samesaengil"),
        ],
      ),
    ],
  );

  const svg = await satori(markup as never, {
    width: 1200,
    height: 630,
    fonts: [{ name: "NotoSansJP", data: FONT, weight: 700, style: "normal" }],
  });
  return new Uint8Array(new Resvg(svg).render().asPng());
}
