// OG 画像用フォントのサブセットを 1 回だけ作る取込スクリプト（生成物はコミットする）。
// 実行: npm run import:font
//
// OG 画像には **人名を入れない**（固定文言＋日付＋件数だけ）と決めているので、必要な字形は
// 数字・少数の固定かな漢字・ラテンだけ。だからサブセットは数十KB に収まり、ビルドは
// ネットワークに依存しない。人名を入れ始めると動的サブセットが必要になる＝この判断が要。
//
// フォント: Noto Sans JP（SIL Open Font License 1.1）。再配布はライセンス同梱が条件なので
// OFL.txt も一緒に取得して置く。
import fs from "node:fs";
import path from "node:path";
import subsetFont from "subset-font";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "src", "assets", "fonts");
const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf";
const LICENSE_URL = "https://github.com/google/fonts/raw/main/ofl/notosansjp/OFL.txt";

/** OG 画像に出す全文字（ここに無い字は豆腐になる。src/lib/og.ts の文言を変えたらここも足すこと）。 */
export const OG_GLYPHS =
  // 日別カード: "7月7日生まれ" / "有名人 226人 ・ キャラ 1932件"
  "0123456789月日生まれ有名人キャラ件・" +
  // 汎用カード: "同じ誕生日" / "有名人 キャラ 記念日"
  "同じ誕記念" +
  // ワードマーク
  "samesaengilabcdefghijklmnopqrstuvwxyz ";

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function run(): Promise<void> {
  console.log("[font] Noto Sans JP を取得中…");
  const [full, license] = await Promise.all([download(FONT_URL), download(LICENSE_URL)]);
  console.log(`[font] 元フォント: ${(full.length / 1024 / 1024).toFixed(1)}MB`);

  // 可変フォントなので太さを 700 に固定してから字形を絞る。
  const subset = await subsetFont(full, OG_GLYPHS, {
    targetFormat: "truetype",
    variationAxes: { wght: 700 },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "NotoSansJP-Subset.ttf"), subset);
  fs.writeFileSync(path.join(OUT_DIR, "LICENSE-OFL.txt"), license);
  console.log(`[font] 出力: src/assets/fonts/NotoSansJP-Subset.ttf (${(subset.length / 1024).toFixed(1)}KB) + LICENSE-OFL.txt`);
}

run().catch((e) => {
  console.error("[font] 失敗:", e);
  process.exit(1);
});
