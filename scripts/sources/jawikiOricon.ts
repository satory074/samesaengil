// 「Template:オリコン週間シングルチャート第1位 YYYY年」（1968年〜）から、その年の週間1位を取得。
//
// 表記ゆれが多いテンプレなので、実データ（1968/1990/1995/2005/2023）で確認した以下を全部吸収する:
//   - パラメータの空白: "| group1= 1月" / "|group1=1月" / "|list2= "
//   - 箇条書きの空白:   "* 5日 …" / "*2日 …"
//   - 複数日:           "*3日・10日・17日・24日 [[…]]"
//   - 合算週の注記:     "*16日（合算週: 2週分） [[…]]"
//   - アーティストの括弧が半角: "[[ResQ!!]] ([[AXXX1S]])"
//   - タイトル内に半角括弧:     "[[Joy to the love (globe)]]（[[globe]]）"
//   - 未リンクのアーティスト:   "（trf）"、& を含む名前
// 年は行に含まれず group が月を表す（listN の月は groupN から引く）。
import type { ChartWeek } from "../../src/lib/types";
import { fetchJson } from "../lib/util";
import { cleanWikitext, firstLink, jaWikiUrl } from "../lib/wikitext";

interface WikitextResponse {
  parse?: { wikitext?: { "*"?: string } };
  error?: { code?: string };
}

const API = "https://ja.wikipedia.org/w/api.php";

/** オリコン週間チャートの開始年（これより前はテンプレが存在しない）。 */
export const ORICON_FIRST_YEAR = 1968;

const GROUP_LINE = /^\|\s*group(\d+)\s*=\s*(\d{1,2})月/;
const LIST_LINE = /^\|\s*list(\d+)\s*=/;
const PARAM_LINE = /^\|/;
/** 行頭の「2日」「23日・30日」＋任意の注記「（合算週: 2週分）」。 */
const DAYS_HEAD = /^((?:\d{1,2}日)(?:・\d{1,2}日)*)\s*(?:[（(][^）)]*[）)])?\s*(.+)$/;
/** 末尾の括弧＝アーティスト（貪欲に取ることで、タイトル内の括弧に誤爆しない）。 */
const ARTIST_TAIL = /^(.*)[（(]([^（()）]*)[）)]\s*$/;

/** パイプ無しリンク（display === target）のときだけ、末尾の曖昧さ回避括弧を落とす。 */
function stripDisambiguation(display: string, target: string): string {
  if (display !== target) return display;
  return display.replace(/\s*[（(][^（()）]*[）)]\s*$/, "").trim() || display;
}

function parseListLine(line: string, month: number): ChartWeek[] {
  const body = line.replace(/^\*+\s*/, "").trim();
  const dm = DAYS_HEAD.exec(body);
  if (!dm) return [];
  const days = dm[1].split("・").map((d) => Number(d.replace("日", "")));
  const rest = dm[2].trim();

  const am = ARTIST_TAIL.exec(rest);
  const titleRaw = (am ? am[1] : rest).trim();
  const artistRaw = am ? am[2] : "";

  const link = firstLink(titleRaw);
  // パイプ無しリンクの末尾括弧は曖昧さ回避（例 [[Joy to the love (globe)]]）なので落とす。
  // パイプありは表示名がそのまま正しい（例 [[Hunter (曲)|Hunter]]）。
  const title = link ? stripDisambiguation(link.name, link.title) : cleanWikitext(titleRaw);
  if (!title) return [];

  return days
    .filter((d) => d >= 1 && d <= 31)
    .map((day) => ({
      month,
      day,
      title,
      artist: cleanWikitext(artistRaw),
      url: link ? jaWikiUrl(link.title) : "",
    }));
}

function parseTemplate(wt: string): ChartWeek[] {
  const months = new Map<string, number>(); // groupN の N -> 月
  const out: ChartWeek[] = [];
  let currentMonth: number | null = null;

  for (const raw of wt.split("\n")) {
    const g = GROUP_LINE.exec(raw);
    if (g) {
      months.set(g[1], Number(g[2]));
      continue;
    }
    const l = LIST_LINE.exec(raw);
    if (l) {
      currentMonth = months.get(l[1]) ?? null; // group は list より前に出る
      continue;
    }
    if (PARAM_LINE.test(raw)) {
      currentMonth = null; // group/list 以外のパラメータに入ったら箇条書きの文脈は切れる
      continue;
    }
    if (!raw.trimStart().startsWith("*") || currentMonth == null) continue;
    out.push(...parseListLine(raw.trimStart(), currentMonth));
  }

  out.sort((a, b) => a.month - b.month || a.day - b.day);
  return out;
}

/** その年の週間1位一覧。テンプレが無い年（1967以前など）は []。 */
export async function fetchOriconYear(year: number): Promise<ChartWeek[]> {
  if (year < ORICON_FIRST_YEAR) return [];
  const params = new URLSearchParams({
    action: "parse",
    page: `Template:オリコン週間シングルチャート第1位 ${year}年`,
    prop: "wikitext",
    format: "json",
    origin: "*",
  });
  const data = await fetchJson<WikitextResponse>(`${API}?${params.toString()}`);
  // 存在しないページでも HTTP 200 + {"error":{"code":"missingtitle"}} が返る（HttpError にならない）。
  const wt = data.parse?.wikitext?.["*"];
  if (!wt) return [];
  return parseTemplate(wt);
}
