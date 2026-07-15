// 「その画像は本当に顔写真か」の判定。顔写真を出すすべての経路（jawiki pageimages / Wikidata P18 /
// Commons depicts）が同じ関門を通るように、ここ 1 か所に置く。
//
// なぜ要るか（どちらも実データで確認した）:
//  - jawiki の pageimages は記事の代表画像であって顔写真とは限らない。3.0%(1,163/39,063) が
//    **Gthumb.svg（Wikipedia の「画像なし」アイコンそのもの）**・グループのロゴ・墓・シルエット・家紋。
//    例: 今田美奈のサムネは `HKT48_logo.svg.png`（白抜きロゴ＝ダーク背景で透明な空箱に見える）。
//  - Wikidata P18 は「項目の代表画像」であって顔写真とは限らない。
//    例: 今田美桜の P18 は `Nagoya PARCO seen from Otsu-dori.jpg`（広告看板が写った**建物**）。
//
// 顔でない画像を顔として出すくらいなら、空欄（＝イニシャルのプレースホルダ）の方がよい。
// 弾いた人は外部ソース（TMDB 等）のフォールバックに回るので、多くはそこで本物の顔写真が入る。

/**
 * ファイル名から明らかに顔写真でないもの（アイコン・ロゴ・署名・墓・銅像・紋章・音声・SVG 等）。
 * `panoramio` は地理タグ付き写真サービス由来＝風景・建物が多い（実例: やなせたかしの名を含む
 * アンパンマン記念碑の panoramio 写真）ので弾く。音声拡張子は Commons が名前空間6で音声も返すため。
 */
const NOT_A_PORTRAIT =
  /(^|[\s_\-])(signature|autograph|grave|tomb|cemetery|logo|monument|statue|plaque|poster|emblem|flag|silhouette|icon|panoramio)([\s_\-.]|$)|署名|墓|記念碑|銅像|紋章|^gthumb|\.(svg|ogg|oga|wav|wave|mid|midi|flac|opus|mp3|mpga|pdf|tif|tiff|webm|ogv)$/i;

export function looksLikePortrait(fileName: string): boolean {
  return Boolean(fileName) && !NOT_A_PORTRAIT.test(fileName);
}

/**
 * Commons のサムネ URL から**元ファイル名**を取り出す。
 *   .../commons/thumb/6/62/HKT48_logo.svg/330px-HKT48_logo.svg.png → HKT48_logo.svg
 *   .../commons/c/ce/志尊淳_2.jpg                                   → 志尊淳_2.jpg
 * 末尾のセグメント（330px-...png）だけ見ると **SVG 由来が .png に化けていて拡張子で弾けない**。
 */
export function sourceFileFromThumbUrl(url: string): string {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* 壊れたエスケープはそのまま扱う */
  }
  const parts = decoded.split("?")[0].split("/").filter(Boolean);
  if (parts.length === 0) return "";
  // thumb 形式なら元ファイル名は最後から2番目のセグメント。
  const i = parts.indexOf("thumb");
  if (i >= 0 && parts.length >= 2) return parts[parts.length - 2];
  return parts[parts.length - 1];
}

/** 写真 URL が顔写真らしいか（元ファイル名で判定）。 */
export function photoUrlLooksLikePortrait(url: string): boolean {
  return Boolean(url) && looksLikePortrait(sourceFileFromThumbUrl(url));
}

/** 発音記号（マクロン等）を落とす。"Tōno" → "Tono"。 */
function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * P18/Commons のファイル名が**その人物の名前を含む**か。拒否リストで弾けない非ポートレート
 * （今田美桜の PARCO ビル等）への本命の関門。実際の肖像ファイルはほぼ例外なく名前を含む:
 *   "Sei Shiraishi 2019.jpg" / "Tono_Hikaru_2020.jpg" / "BuzzFeed MUSIC AWARDS JAPAN 2026 - 畑芽育.png"
 * 名前を含まない肖像は取りこぼすが、顔でない画像を顔として出すよりはよい。
 *
 * Wikidata の英語ラベルは長音をマクロンで書く（"Hikaru Tōno"）のに Commons のファイル名は素の綴り
 * （"Tono Hikaru 2020.jpg"）が普通なので、**両方から発音記号を落として**突き合わせる。
 * ここを見落とすと 齋藤/大野/優希… といった長音を含む日本人名がまとめて弾かれる。
 */
export function p18FileMatchesPerson(
  file: string,
  jaNames: (string | undefined)[],
  enNames: (string | undefined)[],
): boolean {
  const base = file.replace(/_/g, " ").replace(/\.[a-z0-9]+$/i, "");
  for (const ja of jaNames) {
    if (ja && base.includes(ja)) return true;
  }
  const lower = deaccent(base).toLowerCase();
  for (const en of enNames) {
    const tokens = deaccent(en ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) continue;
    // 全トークンが単語として現れること（部分一致だと "sei" が "seen" に当たるような誤爆をする）。
    if (tokens.every((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(lower))) return true;
  }
  return false;
}
