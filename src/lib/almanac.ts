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
