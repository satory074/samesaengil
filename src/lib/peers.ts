// 「同じ学年の有名人」用の学年判定・分類・再カット（純関数・DOM 非依存＝tsx でテスト可能）。
//
// 新しいソースは足さない: 日別 JSON（public/data/days/MM-DD.json）の people には既に
// 生年・肩書き・写真・人気（年間閲覧数）が入っている。それを**学年（年度）**で逆引きしたものが
// per-year JSON の people（生成は scripts/aggregateYears.ts）。ここはその表示側の道具だけ。
import type { YMD } from "./almanac";
import type { Person, YearPerson } from "./types";

/* ---------- 学年（年度） ---------- */

/**
 * その生年月日が属する学年（＝年度。4/2 〜 翌4/1 が1学年）。
 * 4月1日生まれは「早生まれ」で前の学年に入る（年齢は誕生日の前日終了時に加算されるため）。
 *
 *   1995/6/18 → 1995（1995/4/2〜1996/4/1）
 *   1995/3/15 → 1994（1994/4/2〜1995/4/1）＝早生まれ
 *   1995/4/1  → 1994（早生まれの境界）
 *   1995/4/2  → 1995
 */
export function cohortYearOf(ymd: YMD): number {
  const afterApr1 = ymd.month > 4 || (ymd.month === 4 && ymd.day >= 2);
  return afterApr1 ? ymd.year : ymd.year - 1;
}

/** 学年の範囲の見出し（例: 1995 → "1995年4月〜1996年3月"）。境界の 4/1・4/2 は本文で補足する。 */
export function cohortLabel(cohortYear: number): string {
  return `${cohortYear}年4月〜${cohortYear + 1}年3月`;
}

/** 早生まれ（1/1〜4/1）＝暦年より1つ前の学年になる人。 */
export function isEarlyBirth(ymd: { month: number; day: number }): boolean {
  return ymd.month < 4 || (ymd.month === 4 && ymd.day === 1);
}

export type PersonCat = "ent" | "sports" | "music" | "culture" | "other";

/** 表示順。categorize の同着（同じ位置でマッチ）時の優先順でもある。 */
export const CAT_ORDER: PersonCat[] = ["ent", "sports", "music", "culture", "other"];

export const CAT_LABELS: Record<PersonCat, string> = {
  ent: "芸能",
  sports: "スポーツ",
  music: "音楽",
  culture: "文化・アート",
  other: "その他",
};

/**
 * 肩書き（jawiki「M月D日」の誕生日節由来。例「元プロ野球選手」「アイドル、歌手（SixTONES）」）
 * のキーワード。どれにも当たらなければ "other"（政治家・実業家・学者など）。
 *
 * 「陸上」ではなく「陸上競技」なのは、陸上自衛官を拾わないため。
 */
const CAT_RE: Record<Exclude<PersonCat, "other">, RegExp> = {
  ent: /俳優|女優|タレント|お笑い|芸人|声優|アイドル|モデル|アナウンサー|YouTuber|ユーチューバー|司会|落語家|歌舞伎|漫才|コメディア|ダンサー|グラビア|パーソナリティ/,
  sports:
    /野球|サッカー|力士|相撲|プロレス|騎手|ゴルフ|柔道|剣道|空手|弓道|レスリング|ボクシング|格闘|バスケットボール|バレーボール|テニス|卓球|バドミントン|ハンドボール|ラグビー|アメリカンフットボール|ホッケー|スケート|スキー|スノーボード|体操|陸上競技|水泳|競泳|自転車競技|競輪|競艇|オートレース|射撃|アーチェリー|フェンシング|カーリング|ソフトボール|サーファー|クライミング|馬術|レーサー|ドライバー|選手/,
  music:
    /歌手|ミュージシャン|作曲家|作詞家|編曲家|ラッパー|ピアニスト|ギタリスト|ベーシスト|ドラマー|バイオリニスト|指揮者|シンガー|声楽家|音楽|DJ/,
  culture:
    /漫画家|小説家|作家|映画監督|イラストレーター|脚本家|画家|写真家|デザイナー|詩人|建築家|書道家|彫刻家|評論家|アニメーター|棋士/,
};

/**
 * 最初にマッチしたキーワードの**位置が最も早い**カテゴリを採用する。
 * jawiki の肩書きは主業が先頭に来る（「元アナウンサー、タレント」「歌手、俳優」）ので、
 * 固定の優先順位で殴るより主業に沿った分類になる。同着は CAT_ORDER 順。
 */
export function categorize(desc: string): PersonCat {
  let best: PersonCat = "other";
  let bestIdx = Infinity;
  for (const cat of CAT_ORDER) {
    if (cat === "other") continue;
    const m = CAT_RE[cat].exec(desc);
    if (m && m.index < bestIdx) {
      bestIdx = m.index;
      best = cat;
    }
  }
  return best;
}

/** カテゴリ別に分配する（入力は生成時に人気順で確定済みなので、ここでは並べ替えない）。 */
export function groupByCat(people: YearPerson[]): Map<PersonCat, YearPerson[]> {
  const out = new Map<PersonCat, YearPerson[]>();
  for (const cat of CAT_ORDER) out.set(cat, []);
  for (const p of people) out.get(categorize(p.desc))!.push(p);
  return out;
}

/**
 * 生年月日がぴったり同じ人（＝同じ誕生日かつ同い年）。
 * 年 JSON ではなく日別 JSON から引くのは、日別は全件を持っていて、
 * 年 JSON のカテゴリ上限で切られた人も確実に拾えるから。
 */
export function exactMatchesOf(dayPeople: Person[], year: number): Person[] {
  return dayPeople.filter((p) => p.year === year);
}

/** ⭐ に出す人を年リストから除く（同じセクション内での二重表示を防ぐ）。 */
export function withoutExact(yearPeople: YearPerson[], exact: Person[]): YearPerson[] {
  const urls = new Set(exact.map((p) => p.url).filter(Boolean));
  return yearPeople.filter((p) => !urls.has(p.url));
}
