// 日本語版 Wikipedia の「YYYY年」記事から その年のできごとを取得。
//
// 日付ページ（jawikiDay.ts）との決定的な違い:
//   年記事では「1月」という節名が できごと / 誕生 / 死去 の3か所に出る。
//   節名 -> index の Map を素朴に作ると後勝ちで「死去」を掴む。
//   よって **toclevel === 1（トップレベル）の節だけ** を名前で引き、その 1 節の
//   wikitext を取る（section= 指定は小節も含めて返すので、12か月ぶんが 1 回で揃う）。
import { fetchJson } from "../lib/util";
import { cleanWikitext } from "../lib/wikitext";

export interface YearRawEvent {
  month: number;
  day: number;
  text: string;
}

interface SectionsResponse {
  parse?: { sections?: { index?: string; line?: string; toclevel?: number }[] };
}
interface WikitextResponse {
  parse?: { wikitext?: { "*"?: string } };
}

const API = "https://ja.wikipedia.org/w/api.php";

/** トップレベル節名は年によって揺れる（1995年だけ「出来事・事柄」、他は「できごと」）。 */
const EVENT_SECTIONS = ["できごと", "出来事・事柄", "出来事"];

/** 「主な出来事」内で優先したいグループ見出し（;日本国内 が一番刺さる）。 */
const HIGHLIGHT_PRIORITY = /日本/;

function pageTitle(year: number): string {
  return `${year}年`;
}

/** トップレベル(toclevel=1)の節だけを対象に、候補名のどれかに一致する節 index を返す。 */
async function findTopSection(year: number, names: string[]): Promise<string | null> {
  const params = new URLSearchParams({
    action: "parse",
    page: pageTitle(year),
    prop: "sections",
    format: "json",
    origin: "*",
  });
  const data = await fetchJson<SectionsResponse>(`${API}?${params.toString()}`);
  const tops = (data.parse?.sections ?? []).filter((s) => s.toclevel === 1);
  for (const name of names) {
    const hit = tops.find((s) => s.line === name);
    if (hit?.index) return hit.index;
  }
  return null;
}

async function sectionWikitext(year: number, index: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "parse",
    page: pageTitle(year),
    prop: "wikitext",
    section: index,
    format: "json",
    origin: "*",
  });
  const data = await fetchJson<WikitextResponse>(`${API}?${params.toString()}`);
  return data.parse?.wikitext?.["*"] ?? null;
}

// 「* [[1月17日]] - …」形。ただし日付をリンクにしない年もある（2006/2009 は「* 1月2日 - …」）ので
// [[ ]] は任意にする。日付が無い行（月日不明・主な出来事）はここでマッチせず highlights 側へ回る。
const EVENT_LINE = /^\*\s*(?:\[\[)?(\d{1,2})月(\d{1,2})日(?:\]\])?\s*[-－—:：]\s*(.+)$/;

const MAX_TEXT = 100;
const MAX_HIGHLIGHTS = 8;

function parseYearSection(wt: string): { events: YearRawEvent[]; highlights: string[] } {
  const events: YearRawEvent[] = [];
  // 「主な出来事」節の箇条書き。;日本国内 などのグループ見出しでタグ付けして後で並べ替える。
  const highlights: { text: string; priority: boolean }[] = [];

  let inHighlights = false;
  let priorityGroup = false;

  for (const raw of wt.split("\n")) {
    if (/^=+/.test(raw)) {
      // 小節見出し。「主な出来事」の中だけ highlights を拾う。
      inHighlights = /主な出来事/.test(raw);
      priorityGroup = false;
      continue;
    }
    if (raw.startsWith(";")) {
      // 定義リストのグループ見出し（;世界 / ;日本国内 …）。
      priorityGroup = HIGHLIGHT_PRIORITY.test(raw);
      continue;
    }
    if (!raw.startsWith("*")) continue;
    if (raw.startsWith("**") || raw.startsWith("*:") || raw.startsWith("*#")) continue; // 入れ子・継続行

    const m = EVENT_LINE.exec(raw);
    if (m) {
      const text = cleanWikitext(m[3]);
      if (text && text.length <= MAX_TEXT) {
        events.push({ month: Number(m[1]), day: Number(m[2]), text });
      }
      continue;
    }
    if (inHighlights) {
      const text = cleanWikitext(raw.replace(/^\*+\s*/, ""));
      if (text && text.length <= MAX_TEXT) highlights.push({ text, priority: priorityGroup });
    }
  }

  // 日本国内グループを先に、それ以外を後に（順序は元のまま）。
  const ordered = [...highlights.filter((h) => h.priority), ...highlights.filter((h) => !h.priority)];
  return { events, highlights: ordered.slice(0, MAX_HIGHLIGHTS).map((h) => h.text) };
}

/** その年のできごと（日付つき全件）と「主な出来事」。節が無ければ空。 */
export async function fetchYearInfo(year: number): Promise<{ events: YearRawEvent[]; highlights: string[] }> {
  const idx = await findTopSection(year, EVENT_SECTIONS);
  if (!idx) return { events: [], highlights: [] };
  const wt = await sectionWikitext(year, idx);
  if (!wt) return { events: [], highlights: [] };
  return parseYearSection(wt);
}
