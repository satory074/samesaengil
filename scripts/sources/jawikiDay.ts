// 日本語版 Wikipedia の「M月D日」記事から 記念日・年中行事 と できごと を取得。
// 節 index はページ毎に異なるため、必ず section 一覧から名前で引く。
import type { Anniversary, DayEvent } from "../../src/lib/types";
import { fetchJson } from "../lib/util";

interface SectionsResponse {
  parse?: { sections?: { index?: string; line?: string }[] };
}
interface WikitextResponse {
  parse?: { wikitext?: { "*"?: string } };
}

const API = "https://ja.wikipedia.org/w/api.php";

function pageTitle(month: number, day: number): string {
  return `${month}月${day}日`;
}

/** wikitext のリンク・テンプレート・参照・装飾を落として素のテキストに。 */
function cleanWikitext(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "") // 単純なテンプレート（入れ子は1段のみ）
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1") // [[a|b]] -> b
    .replace(/\[\[([^\]]*)\]\]/g, "$1") // [[a]] -> a
    .replace(/'''?/g, "") // 太字・斜体
    .replace(/<[^>]+>/g, "") // 残った HTML タグ
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchSectionIndex(month: number, day: number): Promise<Map<string, string>> {
  const secParams = new URLSearchParams({
    action: "parse",
    page: pageTitle(month, day),
    prop: "sections",
    format: "json",
    origin: "*",
  });
  const secData = await fetchJson<SectionsResponse>(`${API}?${secParams.toString()}`);
  const map = new Map<string, string>();
  for (const s of secData.parse?.sections ?? []) {
    if (s.line && s.index) map.set(s.line, s.index);
  }
  return map;
}

async function sectionWikitext(month: number, day: number, index: string): Promise<string | null> {
  const wtParams = new URLSearchParams({
    action: "parse",
    page: pageTitle(month, day),
    prop: "wikitext",
    section: index,
    format: "json",
    origin: "*",
  });
  const wtData = await fetchJson<WikitextResponse>(`${API}?${wtParams.toString()}`);
  return wtData.parse?.wikitext?.["*"] ?? null;
}

/** 記念日とできごとを 1 ページぶんまとめて取得（section 一覧は 1 回だけ引く）。 */
export async function fetchDayInfo(
  month: number,
  day: number,
): Promise<{ anniversaries: Anniversary[]; events: DayEvent[] }> {
  const sections = await fetchSectionIndex(month, day);
  const annivIdx = sections.get("記念日・年中行事");
  const eventIdx = sections.get("できごと");
  const [annivWt, eventWt] = await Promise.all([
    annivIdx ? sectionWikitext(month, day, annivIdx) : Promise.resolve(null),
    eventIdx ? sectionWikitext(month, day, eventIdx) : Promise.resolve(null),
  ]);
  return {
    anniversaries: annivWt ? parseAnniversaries(annivWt) : [],
    events: eventWt ? parseEvents(eventWt) : [],
  };
}

function parseAnniversaries(wt: string, limit = 8): Anniversary[] {
  const out: Anniversary[] = [];
  for (const raw of wt.split("\n")) {
    const t = raw.trimStart();
    if (!t.startsWith("*")) continue;
    if (t.startsWith("**") || t.startsWith("*:")) continue; // 入れ子・継続行はスキップ
    let line = cleanWikitext(t.replace(/^\*\s*/, ""));
    line = line.replace(/[（(]\s*[）)]/g, "").trim(); // 中身が消えた空カッコを除去
    if (!line) continue;
    // 「ラベル（説明）」または「ラベル - 説明」を分解。
    const m = /^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/.exec(line) || /^(.+?)\s*[-－—]\s+(.+)$/.exec(line);
    const label = (m ? m[1] : line).trim();
    const desc = m ? m[2].trim() : undefined;
    if (label.length === 0 || label.length > 40) continue;
    out.push(desc ? { label, desc } : { label });
    if (out.length >= limit) break;
  }
  return out;
}

/** できごと（直近 limit 件を新しい順で）。 */
function parseEvents(wt: string, limit = 5): DayEvent[] {
  const events: DayEvent[] = [];
  for (const raw of wt.split("\n")) {
    if (!raw.startsWith("*")) continue;
    const line = cleanWikitext(raw.replace(/^\*+\s*/, ""));
    const m = /^(\d{3,4})年?\s*[-－—:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    if (!text || text.length > 80) continue;
    events.push({ year: Number(m[1]), text });
  }
  events.sort((a, b) => b.year - a.year);
  return events.slice(0, limit);
}
