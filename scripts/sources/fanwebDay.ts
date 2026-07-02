// bd.fan-web.jp（誕生日キャラ辞典）の「M月D日」ページから、その日が誕生日の
// アニメ・漫画・ゲームキャラを取得する。1日 ~130 件と豊富で、?month=&day= の
// URL 構築だけで全366日に到達できる（アーカイブ巡回不要）。
//
// 実行時ではなく取込スクリプト（importFanwebCharacters.ts）から一度だけ叩き、
// 成果物はコミット済み JSON にする（aggregate は第三者サイトに実行時依存しない）。
import { fetchText } from "../lib/util";

/** 1 キャラ分の生データ（名前＋作品名のみ。画像・URL は持たない）。 */
export interface FanwebCharacter {
  name: string;
  /** 作品名（英題＋読みが連結される例あり。例「ONE PIECE ワンピース」）。そのまま保持。 */
  work: string;
}

const BASE = "https://bd.fan-web.jp/sayhappy_sp.cgi";

// キャラ 1 件のマークアップ:
//   <font color=crimson><b>トム</b></font>(<a href="//days366.com/search.cgi?...&word=...">ONE PIECE ワンピース</a>)
// 実在の有名人・声優は別マークアップなので、作品リンク（search.cgi）を必須にして二重に防御する。
const CHAR_RE =
  /<font color=crimson><b>(.*?)<\/b><\/font>\(<a\s[^>]*search\.cgi[^>]*>(.*?)<\/a>/gis;

/** HTML エンティティ（名前つき＋数値参照）を素の文字へ。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // & は最後に（二重デコード防止）
}

/** 残った HTML タグを落として decode・空白正規化・trim。 */
function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * 指定日のキャラ一覧を取得。取得失敗・パース 0 件はいずれも [] を返す
 * （呼び出し側で取りこぼしを検出できるように throw しない）。
 */
export async function fetchFanwebCharacters(month: number, day: number): Promise<FanwebCharacter[]> {
  const url = `${BASE}?month=${month}&day=${day}`;
  let html: string;
  try {
    html = await fetchText(url);
  } catch {
    return [];
  }

  const out: FanwebCharacter[] = [];
  for (const m of html.matchAll(CHAR_RE)) {
    const name = clean(m[1]);
    const work = clean(m[2]);
    if (name && work) out.push({ name, work });
  }
  return out;
}
