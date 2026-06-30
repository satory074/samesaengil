// 共有 URL のクエリ（?d=YYYY-MM-DD）を読み書きする純関数。
// DOM・location に触れない＝単体テスト可能。書き込み側（history.replaceState）は main.ts。

export interface BirthInput {
  year: number;
  month: number;
  day: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** "YYYY-MM-DD" を作る。 */
export function encodeDate({ year, month, day }: BirthInput): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "?d=YYYY-MM-DD" を作る（先頭に ? 付き）。 */
export function encodeQuery(input: BirthInput): string {
  const p = new URLSearchParams();
  p.set("d", encodeDate(input));
  return `?${p.toString()}`;
}

/** 日付ファイルのキー "MM-DD"。 */
export function dayKey(month: number, day: number): string {
  return `${pad(month)}-${pad(day)}`;
}

/**
 * クエリ文字列から生年月日を取り出す。妥当でなければ null。
 * 受理: ?d=1995-03-15 / d=1995-3-15（ゼロ詰めなしも許容）。
 */
export function decodeQuery(search: string): BirthInput | null {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = p.get("d");
  if (!raw) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidDate(year, month, day)) return null;
  return { year, month, day };
}

/** 実在する日付か（うるう年・月末を考慮）。 */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

export function daysInMonth(year: number, month: number): number {
  // month: 1-12
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
