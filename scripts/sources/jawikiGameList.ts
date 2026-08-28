// 日本語版 Wikipedia の「〈機種〉のゲームタイトル一覧」から、日本での発売日つきのソフト一覧を取得する。
//
// 実行時ではなく取込スクリプト（importGames.ts）から叩き、成果物はコミット済み JSON にする
// （aggregate は第三者サイトに実行時依存しない）。kinenbiDay.ts と同じ 3 層構成:
// 純関数パーサ / 薄い fetch ラッパ（throw しない） / 呼び出し側で取りこぼしを検出。
//
// 表の方言は実測で 2 つだけ。どちらも「発売日 → タイトル → 発売元」の並び:
//   A) 日付セルが絶対日付      … 2001年3月21日 / {{dts|1988|10|29}}（FC, SFC, GB, SS, PSP, 3DS …）
//   B) 日付セルが月日だけ      … 1月17日 / {{0}}1月10日。年は節見出し「=== 2008年 ===」か
//                                記事名の「(2018年)」から採る（PS, PS2, PS4, PS5, DS, Switch …）
//
// 列位置は決め打ちしない: ヘッダの「発売日」セルの colspan から数える。海外版の発売日を
// 併記する機種（MD は 日本/北米/欧州/その他 の 4 列）があり、タイトル列の位置が機種ごとに違うため。
import { fetchJson } from "../lib/util";
import { cleanWikitext, firstLink } from "../lib/wikitext";

/** 一覧表 1 行ぶんの生データ。 */
export interface RawGame {
  year: number;
  month: number;
  day: number;
  /** 表示名。 */
  name: string;
  /** jawiki 記事タイトル（リンクされていれば）。人気（閲覧数）解決とリンクに使う。 */
  title?: string;
}

const API = "https://ja.wikipedia.org/w/api.php";

// 表を読まない節。**表を直接含む最も深い見出しだけ**を見る（親は見ない）——
// PS Vita の年別記事のように「発売ソフトの形態・変遷 > 発売されたタイトル」と入れ子になっていて、
// 親まで見ると本体の表ごと落ちるため（実際に落ちていた）。親配下の統計表・売上ランキング表は
// 「発売日が先頭列でない」ことで弾かれる（columnLayout の判定）。
const DENY_SECTION =
  /発売されなかった|発売中止|中止された|非売品|非ライセンス|同人|クラブニンテンドー|凡例|脚注|注釈|出典|参考文献|外部リンク|関連項目|一覧表について|その他/;

/** 「そもそも日本の商品として発売されていない」節は、小節まで含めて丸ごと読まない。 */
const DENY_SUBTREE = /発売されなかった|発売中止|非売品|非ライセンス|同人/;

/** 表の中で「これがヘッダ行かどうか」の判定に使う（! で始まる行）。 */
const HEADER_LINE = /^\s*!/;

/** <ref> とコメントを先に落とす（セル分割の邪魔になる複数行ノイズの大半がこれ）。 */
function stripRefs(wt: string): string {
  return wt
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
}

/**
 * 行をセルに分割する。`||` と行頭 `|` が区切りだが、`[[...]]` `{{...}}` の内側は数えない
 * （出典テンプレートは `{{Cite web|和書|url=...}}` のように `|` を大量に含む）。
 */
export function splitCells(row: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let link = 0; // [[ ]] の深さ
  let tpl = 0; // {{ }} の深さ
  let atLineStart = true;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    const next = row[i + 1];
    if (c === "[" && next === "[") {
      link++;
      buf += "[[";
      i++;
      atLineStart = false;
      continue;
    }
    if (c === "]" && next === "]") {
      if (link > 0) link--;
      buf += "]]";
      i++;
      atLineStart = false;
      continue;
    }
    if (c === "{" && next === "{") {
      tpl++;
      buf += "{{";
      i++;
      atLineStart = false;
      continue;
    }
    if (c === "}" && next === "}") {
      if (tpl > 0) tpl--;
      buf += "}}";
      i++;
      atLineStart = false;
      continue;
    }
    if (c === "\n") {
      buf += "\n";
      atLineStart = true;
      continue;
    }
    if (link === 0 && tpl === 0 && c === "|") {
      if (next === "|") {
        cells.push(buf);
        buf = "";
        i++;
        atLineStart = false;
        continue;
      }
      if (atLineStart) {
        // 行頭の単独 `|` もセル区切り。ただし行の一番最初（`|-` 直後）は空セルを作らない。
        if (cells.length === 0 && buf.trim() === "") buf = "";
        else cells.push(buf);
        buf = "";
        atLineStart = false;
        continue;
      }
    }
    buf += c;
    if (!/\s/.test(c)) atLineStart = false;
  }
  cells.push(buf);
  return cells;
}

/** セル先頭の HTML 属性（style=… align=… |）を落とす。`{{ }}` や `[[ ]]` は属性ではない。 */
function stripCellAttrs(cell: string): string {
  const m = /^([^|[{\n]*?=[^|[{\n]*?)\|(?!\|)/.exec(cell);
  return m ? cell.slice(m[0].length) : cell;
}

/** {{0}}（幅そろえ）・span・太字などを落として日付判定できる形にする。 */
function normalizeDateCell(cell: string): string {
  return stripCellAttrs(cell)
    .replace(/\{\{0\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/'''?/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, "$1")
    .trim();
}

// {{dts|1993|1|14}} と、末尾に空パラメータが付く {{dts|1993|1|14|}} の両方（メガドライブに多い）。
const DTS_YMD = /\{\{\s*[Dd]ts\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*(?:\|[^{}]*)?\}\}/;
const FULL_DATE = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/;
const MD_ONLY = /(\d{1,2})月\s*(\d{1,2})日/;

/**
 * 日付セルを解釈する純関数。年が書かれていなければ sectionYear で補う（方言B）。
 * 発売日が未定・国内未発売（{{Unreleased}} など）や年月までの行は null（＝その行は捨てる）。
 */
export function parseDateCell(cell: string, sectionYear: number | null): { year: number; month: number; day: number } | null {
  const s = normalizeDateCell(cell);
  const dts = DTS_YMD.exec(s);
  if (dts) return { year: Number(dts[1]), month: Number(dts[2]), day: Number(dts[3]) };
  const full = FULL_DATE.exec(s);
  if (full) return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  // {{...}} が残っている＝ {{Unreleased}} や英語日付の {{dts|October 15, 1986}}。月日だけの判定に進む前に落とす。
  const bare = s.replace(/\{\{[^{}]*\}\}/g, "").trim();
  if (!bare) return null;
  const md = MD_ONLY.exec(bare);
  if (md && sectionYear != null) return { year: sectionYear, month: Number(md[1]), day: Number(md[2]) };
  return null;
}

const KARIRINK = /\{\{\s*仮リンク\s*\|\s*([^|}]+)/;
// {{ubl|日本語名|English Title}}。リンク入りは先に firstLink で拾われるのでここは素の文字列だけ。
const UBL = /\{\{\s*[Uu]bl\s*\|\s*([^|}]+)/;

/**
 * タイトルセルから「表示名」と「jawiki 記事タイトル」を取り出す純関数。
 * [[記事名|表示名]] / [[記事名]] / {{仮リンク|表示名|en|…}} / {{ubl|[[A]]|英題}} / プレーン文字列。
 */
export function parseTitleCell(cell: string): { name: string; title?: string } | null {
  // ソートキー（<span style="display:none">ふ02</span>）や属性を先に落とす。
  const raw = stripCellAttrs(cell).replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
  // 英語副題は <br /> 以降に置かれる。日本語名だけを採る。
  const head = raw.split(/<br\s*\/?>/i)[0];

  const link = firstLink(head);
  if (link) {
    const name = cleanWikitext(link.name).replace(/\*+$/, "").trim();
    if (!name) return null;
    // 節リンク（[[作品#他機種版|表示]]）は記事側に # を残さない。
    return { name, title: link.title.split("#")[0].trim() || undefined };
  }
  const kari = KARIRINK.exec(head);
  if (kari) {
    const name = cleanWikitext(kari[1]).trim();
    return name ? { name } : null;
  }
  const ubl = UBL.exec(head);
  if (ubl) {
    const inner = firstLink(ubl[1]);
    if (inner) return { name: cleanWikitext(inner.name), title: inner.title.split("#")[0].trim() || undefined };
    const name = cleanWikitext(ubl[1]).trim();
    return name ? { name } : null;
  }
  const name = cleanWikitext(head).replace(/\*+$/, "").trim();
  return name ? { name } : null;
}

/**
 * ヘッダ行から「発売日」列の幅を読み、タイトル列の位置を返す。
 * 海外版の発売日を併記する機種があり（メガドライブは 日本/北米/欧州/その他 の 4 列）、
 * タイトル列の位置が機種ごとに違うので colspan から数える。
 * **発売日が先頭列でない表は読まない**——「順位 / タイトル / 発売日」の売上ランキング表が
 * 同じ節に同居しており、これが唯一の確実な見分け方（実表はすべて発売日が先頭列）。
 */
function columnLayout(headerLines: string[]): { titleIdx: number } | null {
  for (const line of headerLines) {
    let col = 0;
    for (const cell of line.replace(/^\s*!/, "").split("!!")) {
      const span = /colspan\s*=\s*"?(\d+)"?/i.exec(cell);
      const width = span ? Number(span[1]) : 1;
      // 「配信日」は Xbox のダウンロード専用タイトル表など、配信のみの機種で使われる同義語。
      if (/発売日|配信日/.test(cell)) return col === 0 ? { titleIdx: width } : null;
      col += width;
    }
  }
  return null;
}

/** 見出しスタックから「その節の年」を決める。深い方の見出しにある西暦を優先、無ければ null。 */
function yearOfPath(path: string[]): number | null {
  for (let i = path.length - 1; i >= 0; i--) {
    if (!path[i]) continue; // レベル1（= 見出し）は使わないので穴が空きうる
    const m = /(\d{4})年/.exec(path[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 記事名の「(2018年)」から年を取る（Switch のように節が月だけの記事のため）。単年でなければ null。 */
export function yearOfArticle(article: string): number | null {
  const m = /\((\d{4})年\)\s*$/.exec(article);
  return m ? Number(m[1]) : null;
}

/**
 * 一覧記事の wikitext から発売ソフトを抽出する純関数（smoketest 対象）。
 * ヘッダに「発売日」を持つ表だけを、拒否リストに当たらない節の中から読む。
 */
export function parseGameList(wikitext: string, fallbackYear: number | null = null): RawGame[] {
  const out: RawGame[] = [];
  const lines = stripRefs(wikitext).split("\n");
  const path: string[] = []; // 見出しスタック（index = level-1）

  let depth = 0; // {| }| の入れ子（セル内に表が入ることがある）
  let buf: string[] = [];
  let tableAllowed = true; // 見出しより前に表がある記事もあるので既定は許可

  const flush = (): void => {
    if (buf.length) parseTable(buf.join("\n"), yearOfPath(path) ?? fallbackYear, out);
    buf = [];
  };

  for (const line of lines) {
    const head = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (head && depth === 0) {
      const level = head[1].length;
      path.length = Math.max(0, level - 1);
      path[level - 1] = head[2];
      tableAllowed = !DENY_SECTION.test(head[2]) && !path.some((p) => p && DENY_SUBTREE.test(p));
      continue;
    }
    if (/^\s*\{\|/.test(line)) {
      depth++;
      if (depth === 1) buf = tableAllowed ? [line] : [];
      else if (buf.length) buf.push(line);
      continue;
    }
    if (depth > 0 && /^\s*\|\}/.test(line)) {
      depth--;
      if (depth === 0) flush();
      else if (buf.length) buf.push(line);
      continue;
    }
    if (depth > 0 && buf.length) buf.push(line);
  }
  flush();
  return out;
}

/** 1 つの表を行に割ってパースし、out に足す。 */
function parseTable(table: string, sectionYear: number | null, out: RawGame[]): void {
  const headerLines = table.split("\n").filter((l) => HEADER_LINE.test(l));
  const layout = columnLayout(headerLines);
  if (!layout) return; // 発売日列が無い（統計・凡例）／先頭列でない（売上ランキング）表は読まない

  for (const chunk of table.split(/\n\s*\|-/).slice(1)) {
    const body = chunk.replace(/^[^\n]*\n/, "\n"); // |- 行に付いた属性を捨てる
    if (HEADER_LINE.test(body.trim())) continue;
    const cells = splitCells(body);
    const dateCell = cells[0];
    const titleCell = cells[layout.titleIdx];
    if (dateCell == null || titleCell == null) continue;

    const date = parseDateCell(dateCell, sectionYear);
    if (!date) continue;
    if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) continue;
    const title = parseTitleCell(titleCell);
    if (!title) continue;

    out.push({ ...date, name: title.name, title: title.title });
  }
}

interface WikitextResponse {
  parse?: { wikitext?: string };
}

/**
 * 一覧記事 1 本ぶんを取得してパースする。
 * 取得失敗・パース 0 件はいずれも [] を返す（呼び出し側で取りこぼしを検出できるように throw しない）。
 */
export async function fetchGameList(article: string): Promise<RawGame[]> {
  const params = new URLSearchParams({
    action: "parse",
    page: article,
    prop: "wikitext",
    formatversion: "2",
    format: "json",
    redirects: "1",
    origin: "*",
  });
  let wt: string | undefined;
  try {
    const data = await fetchJson<WikitextResponse>(`${API}?${params.toString()}`);
    wt = data.parse?.wikitext;
  } catch {
    return [];
  }
  if (!wt) return [];
  return parseGameList(wt, yearOfArticle(article));
}
