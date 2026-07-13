// エンジン純関数のスモークテスト。実行: npx tsx scripts/smoketest.ts
// 1) almanac（星座・誕生石・干支・和暦・世代・年齢・誕生花）
// 2) share（日付クエリの encode/decode・妥当性判定）
import {
  ageOf,
  birthFlowerOf,
  birthstoneOf,
  daysLivedOf,
  etoOf,
  generationOf,
  jdnToYmd,
  kyuseiOf,
  lifePathOf,
  moonAgeOf,
  nextMilestoneOf,
  warekiOf,
  weekdayOf,
  ymdToJdn,
  zodiacOf,
} from "../src/lib/almanac";
import {
  dayKey,
  daysInMonth,
  decodeQuery,
  encodeDate,
  encodeQuery,
  isLeap,
  isValidDate,
} from "../src/app/share";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
}

// ---- 1) 星座 ----
{
  assert(zodiacOf({ month: 3, day: 15 }).name === "うお座", "3/15 うお座");
  assert(zodiacOf({ month: 3, day: 20 }).name === "うお座", "3/20 うお座（境界・末日）");
  assert(zodiacOf({ month: 3, day: 21 }).name === "おひつじ座", "3/21 おひつじ座（境界・初日）");
  assert(zodiacOf({ month: 12, day: 22 }).name === "やぎ座", "12/22 やぎ座（年跨ぎ開始）");
  assert(zodiacOf({ month: 1, day: 19 }).name === "やぎ座", "1/19 やぎ座（年跨ぎ終端）");
  assert(zodiacOf({ month: 1, day: 20 }).name === "みずがめ座", "1/20 みずがめ座");
  assert(zodiacOf({ month: 7, day: 22 }).name === "かに座", "7/22 かに座");
  assert(zodiacOf({ month: 7, day: 23 }).name === "しし座", "7/23 しし座");
  assert(zodiacOf({ month: 12, day: 31 }).name === "やぎ座", "12/31 やぎ座");
  console.log("[zodiac] OK");
}

// ---- 2) 誕生石・誕生花 ----
{
  assert(birthstoneOf(3) === "アクアマリン", "3月 アクアマリン");
  assert(birthstoneOf(4) === "ダイヤモンド", "4月 ダイヤモンド");
  assert(birthstoneOf(1) === "ガーネット", "1月 ガーネット");
  assert(birthFlowerOf(3).flower === "チューリップ", "3月 チューリップ");
  assert(birthFlowerOf(6).flower === "バラ" && birthFlowerOf(6).meaning.length > 0, "6月 バラ＋花言葉");
  console.log("[stone/flower] OK");
}

// ---- 3) 干支 ----
{
  assert(etoOf(2008).name === "子", "2008 子年");
  assert(etoOf(1995).name === "亥" && etoOf(1995).animal === "いのしし", "1995 亥年");
  assert(etoOf(2024).name === "辰", "2024 辰年");
  assert(etoOf(4).name === "子", "西暦4年 子年（基準）");
  assert(etoOf(2).name === "戌", "西暦2年でも負にならない");
  console.log("[eto] OK");
}

// ---- 4) 和暦・世代 ----
{
  assert(warekiOf({ year: 1995, month: 3, day: 15 })?.label === "平成7年", "平成7年");
  assert(warekiOf({ year: 2019, month: 5, day: 1 })?.label === "令和元年", "令和元年（5/1）");
  assert(warekiOf({ year: 2019, month: 4, day: 30 })?.label === "平成31年", "平成31年（4/30）");
  assert(warekiOf({ year: 1989, month: 1, day: 8 })?.label === "平成元年", "平成元年（1/8）");
  assert(warekiOf({ year: 1989, month: 1, day: 7 })?.label === "昭和64年", "昭和64年（1/7）");
  assert(warekiOf({ year: 1926, month: 12, day: 25 })?.label === "昭和元年", "昭和元年");
  assert(warekiOf({ year: 1867, month: 1, day: 1 }) === null, "明治より前は null");
  assert(generationOf(2000) === "Z世代", "2000 Z世代");
  assert(generationOf(1990) === "ミレニアル世代", "1990 ミレニアル");
  assert(generationOf(2015) === "α世代", "2015 α世代");
  console.log("[wareki/gen] OK");
}

// ---- 5) 年齢 ----
{
  assert(ageOf({ year: 1995, month: 3, day: 15 }, { year: 2026, month: 6, day: 30 }) === 31, "誕生日後は31歳");
  assert(ageOf({ year: 1995, month: 7, day: 1 }, { year: 2026, month: 6, day: 30 }) === 30, "誕生日前は30歳");
  assert(ageOf({ year: 2026, month: 6, day: 30 }, { year: 2026, month: 6, day: 30 }) === 0, "当日は0歳");
  console.log("[age] OK");
}

// ---- 6) share（日付クエリ） ----
{
  assert(encodeDate({ year: 1995, month: 3, day: 5 }) === "1995-03-05", "encodeDate ゼロ詰め");
  assert(encodeQuery({ year: 1995, month: 3, day: 15 }) === "?d=1995-03-15", "encodeQuery");
  assert(dayKey(3, 5) === "03-05", "dayKey");

  const dec = decodeQuery("?d=1995-03-15");
  assert(dec?.year === 1995 && dec.month === 3 && dec.day === 15, "decodeQuery 正常");
  const lenient = decodeQuery("?d=1995-3-15");
  assert(lenient?.month === 3 && lenient.day === 15, "decodeQuery ゼロ詰めなしも許容");
  assert(decodeQuery("?d=2024-02-29")?.day === 29, "うるう年 2/29 は有効");
  assert(decodeQuery("?d=2026-02-29") === null, "非うるう年 2/29 は無効");
  assert(decodeQuery("?d=2000-13-01") === null, "13月は無効");
  assert(decodeQuery("") === null, "空クエリ");
  assert(decodeQuery("?d=abc") === null, "不正文字列");

  // round-trip
  const inp = { year: 2003, month: 12, day: 24 };
  const round = decodeQuery(encodeQuery(inp));
  assert(JSON.stringify(round) === JSON.stringify(inp), "encode→decode round-trip");

  assert(isLeap(2000) && !isLeap(1900) && isLeap(2024) && !isLeap(2023), "うるう年判定");
  assert(daysInMonth(2024, 2) === 29 && daysInMonth(2023, 2) === 28, "2月の日数");
  assert(isValidDate(2000, 2, 29) && !isValidDate(1900, 2, 29) && !isValidDate(2000, 2, 30), "isValidDate");
  console.log("[share] OK");
}

// ---- 7) ユリウス通日・曜日・月齢・キリ番・数秘・九星 ----
{
  // JDN（基準: 2000-01-01 = 2451545）と逆変換の round-trip
  assert(ymdToJdn({ year: 2000, month: 1, day: 1 }) === 2451545, "JDN 基準 2000-01-01");
  for (const ymd of [
    { year: 1995, month: 3, day: 15 },
    { year: 2000, month: 2, day: 29 },
    { year: 1900, month: 1, day: 1 },
    { year: 2026, month: 12, day: 31 },
  ]) {
    const back = jdnToYmd(ymdToJdn(ymd));
    assert(JSON.stringify(back) === JSON.stringify(ymd), `JDN round-trip ${JSON.stringify(ymd)}`);
  }

  // 曜日（Date を使わず JDN から）
  assert(weekdayOf({ year: 1995, month: 3, day: 15 }).name === "水曜日", "1995-03-15 は水曜");
  assert(weekdayOf({ year: 2000, month: 2, day: 29 }).name === "火曜日", "2000-02-29 は火曜（うるう境界）");
  assert(weekdayOf({ year: 2000, month: 1, day: 1 }).name === "土曜日", "2000-01-01 は土曜");

  // 月齢（新月の日は「新月」に丸まる）
  assert(moonAgeOf({ year: 2000, month: 1, day: 6 }).phase === "新月", "2000-01-06 は新月");
  const full = moonAgeOf({ year: 2000, month: 1, day: 21 });
  assert(full.phase === "満月", "2000-01-21 は満月");
  assert(full.age >= 0 && full.age < 29.6, "月齢は 0〜29.5 の範囲");

  // 生きた日数・キリ番
  const birth = { year: 1995, month: 3, day: 15 };
  const today = { year: 2026, month: 7, day: 13 };
  assert(daysLivedOf(birth, today) === 11443, "1995-03-15 → 2026-07-13 は 11443 日目");
  const ms = nextMilestoneOf(birth, today);
  assert(ms?.days === 15000, "次のキリ番は 15000 日目");
  assert(ms?.daysUntil === 15000 - 11443, "キリ番までの残り日数");
  assert(ymdToJdn(ms!.date) === ymdToJdn(birth) + 15000, "キリ番の日付が JDN 逆変換と一致");
  assert(nextMilestoneOf(birth, birth)?.days === 1000, "生まれた当日なら 1000 日目が次");

  // 数秘（マスターナンバーは維持）
  assert(lifePathOf({ year: 1995, month: 3, day: 15 }).number === 33, "1995-03-15 は 33（マスター）");
  assert(lifePathOf({ year: 2001, month: 6, day: 2 }).number === 11, "2001-06-02 は 11（マスター）");
  assert(lifePathOf({ year: 2000, month: 1, day: 1 }).number === 4, "2000-01-01 は 4");
  assert(lifePathOf({ year: 1995, month: 3, day: 15 }).label.length > 0, "ライフパスにラベルがある");

  // 九星（立春 2/4 が年の境目＝ここが本質）
  assert(kyuseiOf({ year: 1995, month: 3, day: 15 }).star === "五黄土星", "1995 生まれは五黄土星");
  assert(kyuseiOf({ year: 2000, month: 2, day: 4 }).star === "九紫火星", "2000-02-04（立春以降）は九紫火星");
  assert(kyuseiOf({ year: 2000, month: 2, day: 3 }).star === "一白水星", "2000-02-03（立春前）は前年扱い＝一白水星");
  assert(kyuseiOf({ year: 2000, month: 1, day: 1 }).star === "一白水星", "元日も前年扱い");
  assert(kyuseiOf({ year: 1999, month: 12, day: 31 }).star === "一白水星", "1999 生まれは一白水星");
  console.log("[jdn/weekday/moon/milestone/lifepath/kyusei] OK");
}

console.log("\n✅ smoketest passed");
