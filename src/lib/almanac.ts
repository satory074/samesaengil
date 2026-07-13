// 年・月日から算出できる「誕生日の豆知識」をまとめた純関数群。
// DOM・Date.now() に依存しない（age だけ基準日を引数で受ける）＝テスト可能。

export interface MD {
  month: number; // 1-12
  day: number; // 1-31
}

export interface YMD extends MD {
  year: number;
}

/* ---------- 星座 ---------- */

export interface Zodiac {
  name: string;
  emoji: string;
  range: string;
}

// 各星座の「開始日（含む）」。最後の やぎ座 は年をまたぐので特別扱い。
const ZODIAC: { from: MD; z: Zodiac }[] = [
  { from: { month: 1, day: 20 }, z: { name: "みずがめ座", emoji: "♒", range: "1/20–2/18" } },
  { from: { month: 2, day: 19 }, z: { name: "うお座", emoji: "♓", range: "2/19–3/20" } },
  { from: { month: 3, day: 21 }, z: { name: "おひつじ座", emoji: "♈", range: "3/21–4/19" } },
  { from: { month: 4, day: 20 }, z: { name: "おうし座", emoji: "♉", range: "4/20–5/20" } },
  { from: { month: 5, day: 21 }, z: { name: "ふたご座", emoji: "♊", range: "5/21–6/21" } },
  { from: { month: 6, day: 22 }, z: { name: "かに座", emoji: "♋", range: "6/22–7/22" } },
  { from: { month: 7, day: 23 }, z: { name: "しし座", emoji: "♌", range: "7/23–8/22" } },
  { from: { month: 8, day: 23 }, z: { name: "おとめ座", emoji: "♍", range: "8/23–9/22" } },
  { from: { month: 9, day: 23 }, z: { name: "てんびん座", emoji: "♎", range: "9/23–10/23" } },
  { from: { month: 10, day: 24 }, z: { name: "さそり座", emoji: "♏", range: "10/24–11/22" } },
  { from: { month: 11, day: 23 }, z: { name: "いて座", emoji: "♐", range: "11/23–12/21" } },
  { from: { month: 12, day: 22 }, z: { name: "やぎ座", emoji: "♑", range: "12/22–1/19" } },
];

const mdNum = (m: number, d: number): number => m * 100 + d;

export function zodiacOf({ month, day }: MD): Zodiac {
  const v = mdNum(month, day);
  // 12/22 以降 か 1/19 以前 は やぎ座。
  if (v >= mdNum(12, 22) || v <= mdNum(1, 19)) {
    return ZODIAC[ZODIAC.length - 1].z;
  }
  // それ以外は「from 以上で最大の星座」。
  let found = ZODIAC[0].z;
  for (const { from, z } of ZODIAC) {
    if (v >= mdNum(from.month, from.day)) found = z;
  }
  return found;
}

/* ---------- 誕生石（月別） ---------- */

const BIRTHSTONES: string[] = [
  "ガーネット", // 1
  "アメジスト", // 2
  "アクアマリン", // 3
  "ダイヤモンド", // 4
  "エメラルド", // 5
  "真珠（パール）", // 6
  "ルビー", // 7
  "ペリドット", // 8
  "サファイア", // 9
  "オパール", // 10
  "トパーズ", // 11
  "トルコ石", // 12
];

export function birthstoneOf(month: number): string {
  return BIRTHSTONES[month - 1] ?? "";
}

/* ---------- 干支（年） ---------- */

export interface Eto {
  name: string; // 子, 丑, ...
  reading: string; // ね, うし, ...
  animal: string; // ねずみ, うし, ...
  emoji: string;
}

const ETO: Eto[] = [
  { name: "子", reading: "ね", animal: "ねずみ", emoji: "🐭" },
  { name: "丑", reading: "うし", animal: "うし", emoji: "🐮" },
  { name: "寅", reading: "とら", animal: "とら", emoji: "🐯" },
  { name: "卯", reading: "う", animal: "うさぎ", emoji: "🐰" },
  { name: "辰", reading: "たつ", animal: "たつ（龍）", emoji: "🐲" },
  { name: "巳", reading: "み", animal: "へび", emoji: "🐍" },
  { name: "午", reading: "うま", animal: "うま", emoji: "🐴" },
  { name: "未", reading: "ひつじ", animal: "ひつじ", emoji: "🐑" },
  { name: "申", reading: "さる", animal: "さる", emoji: "🐵" },
  { name: "酉", reading: "とり", animal: "とり", emoji: "🐔" },
  { name: "戌", reading: "いぬ", animal: "いぬ", emoji: "🐶" },
  { name: "亥", reading: "い", animal: "いのしし", emoji: "🐗" },
];

export function etoOf(year: number): Eto {
  // 西暦4年 = 子年。負にならないように正規化。
  const idx = ((((year - 4) % 12) + 12) % 12);
  return ETO[idx];
}

/* ---------- 和暦（元号） ---------- */

export interface Wareki {
  era: string; // 令和 / 平成 / 昭和 / 大正 / 明治
  year: number; // その元号での年（◯年）
  label: string; // 例: "平成7年"
}

// 元号の開始日（含む）。新しい順。
const ERAS: { era: string; from: YMD }[] = [
  { era: "令和", from: { year: 2019, month: 5, day: 1 } },
  { era: "平成", from: { year: 1989, month: 1, day: 8 } },
  { era: "昭和", from: { year: 1926, month: 12, day: 25 } },
  { era: "大正", from: { year: 1912, month: 7, day: 30 } },
  { era: "明治", from: { year: 1868, month: 10, day: 23 } },
];

const ymdNum = (y: number, m: number, d: number): number => y * 10000 + m * 100 + d;

export function warekiOf({ year, month, day }: YMD): Wareki | null {
  const v = ymdNum(year, month, day);
  for (const { era, from } of ERAS) {
    if (v >= ymdNum(from.year, from.month, from.day)) {
      const eraYear = year - from.year + 1;
      return { era, year: eraYear, label: `${era}${eraYear === 1 ? "元" : eraYear}年` };
    }
  }
  return null; // 明治より前は対象外
}

/* ---------- 世代（ポップ呼称） ---------- */

export function generationOf(year: number): string {
  if (year >= 2013) return "α世代";
  if (year >= 1997) return "Z世代";
  if (year >= 1981) return "ミレニアル世代";
  if (year >= 1965) return "X世代";
  if (year >= 1946) return "ベビーブーマー";
  return "";
}

/* ---------- 誕生花（月別・花言葉つき） ---------- */

export interface BirthFlower {
  flower: string;
  meaning: string; // 花言葉
}

const BIRTH_FLOWERS: BirthFlower[] = [
  { flower: "スイセン", meaning: "うぬぼれ・自己愛" }, // 1
  { flower: "ウメ", meaning: "高潔・忠実" }, // 2
  { flower: "チューリップ", meaning: "思いやり・博愛" }, // 3
  { flower: "サクラ", meaning: "精神の美・優美な女性" }, // 4
  { flower: "カーネーション", meaning: "無垢で深い愛" }, // 5
  { flower: "バラ", meaning: "愛・美" }, // 6
  { flower: "ヒマワリ", meaning: "あなただけを見つめる" }, // 7
  { flower: "アサガオ", meaning: "はかない恋・固い絆" }, // 8
  { flower: "ヒガンバナ", meaning: "情熱・独立" }, // 9
  { flower: "コスモス", meaning: "乙女の真心・調和" }, // 10
  { flower: "キク", meaning: "高貴・高潔" }, // 11
  { flower: "ポインセチア", meaning: "祝福・聖夜" }, // 12
];

export function birthFlowerOf(month: number): BirthFlower {
  return BIRTH_FLOWERS[month - 1] ?? { flower: "", meaning: "" };
}

/* ---------- 年齢 ---------- */

/** 基準日 today を渡して満年齢を返す（誕生日が来ていなければ -1）。 */
export function ageOf(birth: YMD, today: YMD): number {
  let age = today.year - birth.year;
  if (mdNum(today.month, today.day) < mdNum(birth.month, birth.day)) age -= 1;
  return age;
}

/* ---------- ユリウス通日（以降の計算の土台） ---------- */
// Date を使わないのは、タイムゾーンとうるう年をライブラリに委ねずテスト可能に保つため。
// グレゴリオ暦のみ（明治改暦より前の日付は暦法が違うので厳密ではない）。

export function ymdToJdn({ year, month, day }: YMD): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function jdnToYmd(jdn: number): YMD {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/* ---------- 生まれた曜日 ---------- */

export interface Weekday {
  index: number; // 0=日曜
  name: string; // 例: "水曜日"
  emoji: string; // 五行になぞらえた絵文字
}

const WEEKDAYS: Weekday[] = [
  { index: 0, name: "日曜日", emoji: "🌞" },
  { index: 1, name: "月曜日", emoji: "🌙" },
  { index: 2, name: "火曜日", emoji: "🔥" },
  { index: 3, name: "水曜日", emoji: "💧" },
  { index: 4, name: "木曜日", emoji: "🌳" },
  { index: 5, name: "金曜日", emoji: "💰" },
  { index: 6, name: "土曜日", emoji: "🪐" },
];

export function weekdayOf(ymd: YMD): Weekday {
  // JDN 0 は月曜。+1 して 7 で割った余りが 0=日曜 になる。
  return WEEKDAYS[(ymdToJdn(ymd) + 1) % 7];
}

/* ---------- 月齢（生まれた日の月の形） ---------- */

export interface MoonPhase {
  age: number; // 月齢（0〜29.5、概算・小数1桁）
  phase: string; // 例: "満月"
  emoji: string;
}

const SYNODIC = 29.530588853; // 朔望月
const NEW_MOON_JDN = 2451550.1; // 2000-01-06 の新月

const MOON_PHASES: { phase: string; emoji: string }[] = [
  { phase: "新月", emoji: "🌑" },
  { phase: "三日月", emoji: "🌒" },
  { phase: "上弦の月", emoji: "🌓" },
  { phase: "十三夜月", emoji: "🌔" },
  { phase: "満月", emoji: "🌕" },
  { phase: "十六夜月", emoji: "🌖" },
  { phase: "下弦の月", emoji: "🌗" },
  { phase: "有明月", emoji: "🌘" },
];

/** ±1日程度の精度の概算（UI では「概算」と明記すること）。 */
export function moonAgeOf(ymd: YMD): MoonPhase {
  const raw = (ymdToJdn(ymd) - NEW_MOON_JDN) % SYNODIC;
  const age = raw < 0 ? raw + SYNODIC : raw;
  const idx = Math.round((age / SYNODIC) * 8) % 8;
  return { age: Math.round(age * 10) / 10, ...MOON_PHASES[idx] };
}

/* ---------- 生きた日数・キリ番 ---------- */

export function daysLivedOf(birth: YMD, today: YMD): number {
  return ymdToJdn(today) - ymdToJdn(birth);
}

export interface Milestone {
  days: number; // 例: 10000（日目）
  date: YMD; // その日が来る（来た）日付
  daysUntil: number; // あと何日
}

const MILESTONES = [
  1000, 2000, 3000, 5000, 7777, 10000, 11111, 15000, 20000, 22222, 25000, 30000, 33333, 35000, 40000,
];

/** まだ迎えていない直近のキリ番記念日。全て過ぎていれば null。 */
export function nextMilestoneOf(birth: YMD, today: YMD): Milestone | null {
  const lived = daysLivedOf(birth, today);
  const days = MILESTONES.find((m) => m > lived);
  if (days == null) return null;
  return { days, date: jdnToYmd(ymdToJdn(birth) + days), daysUntil: days - lived };
}

/* ---------- 数秘術（ライフパスナンバー） ---------- */

export interface LifePath {
  number: number; // 1-9 または マスターナンバー 11/22/33
  label: string;
}

const LIFE_PATH_LABELS: Record<number, string> = {
  1: "リーダー",
  2: "サポーター",
  3: "エンターテイナー",
  4: "堅実家",
  5: "自由人",
  6: "愛情家",
  7: "探究者",
  8: "実力者",
  9: "賢者",
  11: "直感の人",
  22: "大きな夢の人",
  33: "愛と奉仕の人",
};

const digitSum = (n: number): number => {
  let s = 0;
  for (let v = n; v > 0; v = Math.floor(v / 10)) s += v % 10;
  return s;
};

const isMaster = (n: number): boolean => n === 11 || n === 22 || n === 33;

export function lifePathOf({ year, month, day }: YMD): LifePath {
  let n = digitSum(year) + digitSum(month) + digitSum(day);
  // マスターナンバー（11/22/33）はそこで止める。
  while (n > 9 && !isMaster(n)) n = digitSum(n);
  return { number: n, label: LIFE_PATH_LABELS[n] ?? "" };
}

/* ---------- 九星気学（本命星） ---------- */

export interface Kyusei {
  star: string; // 例: "五黄土星"
  element: string; // 五行（水/土/木/金/火）
}

const KYUSEI: Kyusei[] = [
  { star: "一白水星", element: "水" },
  { star: "二黒土星", element: "土" },
  { star: "三碧木星", element: "木" },
  { star: "四緑木星", element: "木" },
  { star: "五黄土星", element: "土" },
  { star: "六白金星", element: "金" },
  { star: "七赤金星", element: "金" },
  { star: "八白土星", element: "土" },
  { star: "九紫火星", element: "火" },
];

/** 本命星。九星の年は立春（2/4 頃）始まりなので、1/1〜2/3 生まれは前年で数える。 */
export function kyuseiOf({ year, month, day }: YMD): Kyusei {
  const y = month < 2 || (month === 2 && day <= 3) ? year - 1 : year;
  let d = digitSum(y);
  while (d > 9) d = digitSum(d);
  const num = 11 - d > 9 ? 11 - d - 9 : 11 - d; // 1-9 に収める
  return KYUSEI[num - 1];
}
