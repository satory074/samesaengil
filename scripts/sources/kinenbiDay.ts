// kinenbi.gr.jp（一般社団法人 日本記念日協会）の日付検索から、その日の記念日を取得する。
// 検索はトップページへの POST（MD=1&M=月&D=日）で、レスポンスは HTML 全ページ（~46KB・UTF-8）。
//
// 実行時ではなく取込スクリプト（importKinenbi.ts）から叩き、成果物はコミット済み JSON にする
// （aggregate は第三者サイトに実行時依存しない）。由来の本文は協会の著作文なので取得せず、
// 表示側は由来ページへのリンク（kinenbiUrl）だけを持つ。
import { clean } from "../lib/html";
import { fetchText } from "../lib/util";

/** 記念日 1 件の生データ。 */
export interface KinenbiEntry {
  /** 由来ページの NM パラメータ（リンク組み立てと重複排除のキー）。 */
  id: number;
  /** 記念日名（「いいきゅうりの日＜４月を除く毎月１９日＞」のような注記つきの生の名前）。 */
  name: string;
  /** 「その他の記念日」枠（元日などの伝統日）由来。リンク先が yurai_other.php になる。 */
  other?: true;
}

const BASE = "https://www.kinenbi.gr.jp/";

// 当日分のセクション区切り。box01=協会認定記念日 / box02=その他の記念日 / box03=周年記念。
// box01 の外（新着記念日サイドバー・周年記念）にも同形式の yurai.php リンクがあるため、
// 必ずマーカー間をスライスしてから抽出する（jawikiDay の「節は名前で引く」と同種の防御）。
const BOX1 = "today_kinenbibox01";
const BOX2 = "today_kinenbibox02";
const BOX3 = "today_kinenbibox03";

// 認定記念日: <A href="yurai.php?TYPE=ofi&MD=3&NM=660" ...><FONT ...>クレープの日</FONT></A>
const OFI_RE = /yurai\.php\?TYPE=ofi&(?:amp;)?MD=3&(?:amp;)?NM=(\d+)"[^>]*>\s*<FONT[^>]*>(.*?)<\/FONT>/gis;
// その他の記念日（元日など）: <A href="yurai_other.php?MD=4&NM=65" ...><FONT ...>元日</FONT></A>
const OTHER_RE = /yurai_other\.php\?MD=4&(?:amp;)?NM=(\d+)"[^>]*>\s*<FONT[^>]*>(.*?)<\/FONT>/gis;
// box02 には日付と無関係な年間指定（「2026 お風呂の年」）が毎ページ混ざるので先頭の西暦で弾く。
const YEAR_NOISE_RE = /^\d{4}[\s　]/;

/** マーカー間の部分文字列（start が無ければ ""、end が無ければ末尾まで）。 */
function slice(html: string, start: string, ...ends: string[]): string {
  const s = html.indexOf(start);
  if (s < 0) return "";
  for (const end of ends) {
    const e = html.indexOf(end, s + start.length);
    if (e >= 0) return html.slice(s, e);
  }
  return html.slice(s);
}

/**
 * 日付検索結果の HTML から当日分の記念日を抽出する純関数（smoketest 対象）。
 * 認定記念日（box01）＋その他の記念日（box02、年間指定ノイズは除外）。id で重複排除。
 */
export function parseKinenbiDay(html: string): KinenbiEntry[] {
  const out: KinenbiEntry[] = [];
  const seen = new Set<string>(); // ofi と other は別の ID 空間なので種別込みで重複排除
  const add = (id: number, name: string, other: boolean): void => {
    const key = `${other ? "o" : "f"}${id}`;
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push(other ? { id, name, other: true } : { id, name });
  };
  for (const m of slice(html, BOX1, BOX2, BOX3).matchAll(OFI_RE)) {
    add(Number(m[1]), clean(m[2]), false);
  }
  for (const m of slice(html, BOX2, BOX3).matchAll(OTHER_RE)) {
    const name = clean(m[2]);
    if (YEAR_NOISE_RE.test(name)) continue;
    add(Number(m[1]), name, true);
  }
  return out;
}

/**
 * 名前の注記「＜４月を除く毎月１９日＞」を desc に分離する純関数。
 * チップを短く保ち、注記は title ツールチップ（Anniversary.desc の既存経路）へ。
 */
export function splitKinenbiName(name: string): { label: string; desc?: string } {
  const m = /^(.+?)\s*[＜<]\s*(.+?)\s*[＞>]\s*$/.exec(name);
  if (!m) return { label: name };
  return { label: m[1].trim(), desc: m[2].trim() };
}

/** 由来ページ URL（GET で動作確認済み。表示側はここへ新しいタブでリンクする）。 */
export function kinenbiUrl(e: Pick<KinenbiEntry, "id" | "other">): string {
  return e.other
    ? `${BASE}yurai_other.php?MD=4&NM=${e.id}`
    : `${BASE}yurai.php?TYPE=ofi&MD=3&NM=${e.id}`;
}

/**
 * 指定日の記念日一覧を取得。取得失敗・パース 0 件はいずれも [] を返す
 * （呼び出し側で取りこぼしを検出できるように throw しない）。
 */
export async function fetchKinenbiDay(month: number, day: number): Promise<KinenbiEntry[]> {
  let html: string;
  try {
    html = await fetchText(BASE, {
      method: "POST",
      body: `MD=1&M=${month}&D=${day}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    return [];
  }
  return parseKinenbiDay(html);
}
