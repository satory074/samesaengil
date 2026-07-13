// 日本語版 Wikipedia の「M月D日」記事から 記念日・年中行事 / できごと / 誕生日（人物・動物）を取得。
// 節 index はページ毎に異なるため、必ず section 一覧から名前で引く。
import type { Anniversary, DayEvent } from "../../src/lib/types";
import { fetchJson } from "../lib/util";
import { cleanWikitext } from "../lib/wikitext";

/** 「誕生日」節の 1 行（人物・動物共通の生データ）。enrich 前。 */
export interface JaRawBirth {
  /** 生年（西暦）。生年非公表・不詳は null。 */
  year: number | null;
  /** jawiki 記事タイトル（曖昧さ回避の括弧つきの場合あり。Q-ID/写真の解決キー）。 */
  title: string;
  /** 表示名。 */
  name: string;
  /** 肩書き（職業など。例「物理学者」「声優」「競走馬」）。 */
  descJa: string;
}

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

/** 記念日・できごと・誕生日を 1 ページぶんまとめて取得（section 一覧は 1 回だけ引く）。 */
export async function fetchDayInfo(
  month: number,
  day: number,
): Promise<{
  anniversaries: Anniversary[];
  events: DayEvent[];
  births: JaRawBirth[];
  animals: JaRawBirth[];
}> {
  const sections = await fetchSectionIndex(month, day);
  const annivIdx = sections.get("記念日・年中行事");
  const eventIdx = sections.get("できごと");
  const birthIdx = sections.get("誕生日");
  const [annivWt, eventWt, birthWt] = await Promise.all([
    annivIdx ? sectionWikitext(month, day, annivIdx) : Promise.resolve(null),
    eventIdx ? sectionWikitext(month, day, eventIdx) : Promise.resolve(null),
    birthIdx ? sectionWikitext(month, day, birthIdx) : Promise.resolve(null),
  ]);
  const { births, animals } = birthWt ? parseBirths(birthWt) : { births: [], animals: [] };
  return {
    anniversaries: annivWt ? parseAnniversaries(annivWt) : [],
    events: eventWt ? parseEvents(eventWt) : [],
    births,
    animals,
  };
}

/** 末尾の没年/生年注記「（+ 1854年）」「（* 1815年）」を落とす。 */
const DEATH_TAIL = /\s*[（(]\s*[+＋*＊][^）)]*[）)]\s*$/;
/** 「生年部 - 人物部」を分割（最初の ' - ' で切る）。 */
const BIRTH_SEP = /^(.+?)\s*[-－—]\s+(.+)$/;
/** 人物部の先頭 [[target|display]] / [[name]]。 */
const FIRST_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;

/** 「誕生日」節の 1 行をパース。動物・人物共通。失敗時 null。 */
function parseBirthLine(body: string): JaRawBirth | null {
  const m = BIRTH_SEP.exec(body);
  if (!m) return null;
  const [, left, rightRaw] = m;
  const ym = /(\d{3,4})\s*年/.exec(left); // 没年は right 側なので left からのみ生年を拾う
  const year = ym ? Number(ym[1]) : null;

  // 末尾の没年注記「（+ [[1854年]]）」を先に落とす（名前抽出が没年リンクを拾わないように）。
  const right = rightRaw.replace(DEATH_TAIL, "");
  // 構造は「名前、肩書き」。最初の読点で名前部と肩書き部に分ける。
  const ci = right.indexOf("、");
  const nameSeg = ci >= 0 ? right.slice(0, ci) : right;
  const descSeg = ci >= 0 ? right.slice(ci + 1) : "";

  // 名前: 名前部の最初のリンク（[[target|display]]）、無ければ素テキスト。
  let title: string;
  let name: string;
  const lm = FIRST_LINK.exec(nameSeg);
  if (lm) {
    title = lm[1].trim();
    name = (lm[2] ?? lm[1]).trim();
  } else {
    name = cleanWikitext(nameSeg).trim();
    title = name;
  }
  if (!name) return null;

  return { year, title, name, descJa: cleanWikitext(descSeg).replace(DEATH_TAIL, "").trim() };
}

/** 「誕生日」節の wikitext を 人物 と 人物以外（動物など）に分けてパース。 */
function parseBirths(wt: string): { births: JaRawBirth[]; animals: JaRawBirth[] } {
  const births: JaRawBirth[] = [];
  const animals: JaRawBirth[] = [];
  let inAnimals = false;
  for (const raw of wt.split("\n")) {
    if (/^=+/.test(raw)) {
      // 小節見出し。「人物以外（動物など）」以降は動物。
      if (/人物以外/.test(raw)) inAnimals = true;
      continue;
    }
    if (!raw.startsWith("*")) continue; // 画像キャプション等はスキップ
    if (raw.startsWith("**") || raw.startsWith("*:") || raw.startsWith("*#")) continue; // 入れ子・継続行
    const p = parseBirthLine(raw.replace(/^\*+\s*/, ""));
    if (p) (inAnimals ? animals : births).push(p);
  }
  return { births, animals };
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
