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
import { eventOnBirthday, eventsForMonth, songForBirthday, spotifyUrl } from "../src/lib/year";
import { kpopOf, vtubersOf } from "../src/lib/oshi";
import { categorize, exactMatchesOf, groupByCat, withoutExact } from "../src/lib/peers";
import type { Character, Person, YearData, YearPerson } from "../src/lib/types";

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

// ---- 8) 生まれた年（オリコン週間1位の選択・できごと抽出） ----
{
  const y: YearData = {
    year: 1995,
    events: [
      { month: 1, day: 17, text: "兵庫県南部地震（阪神・淡路大震災）" },
      { month: 3, day: 15, text: "誕生日ぴったりのできごと" },
      { month: 3, day: 20, text: "地下鉄サリン事件" },
      { month: 7, day: 1, text: "別の月のできごと" },
    ],
    highlights: ["阪神淡路大震災"],
    chartWeeks: [
      { month: 1, day: 2, title: "たぶんオーライ", artist: "SMAP", url: "" },
      { month: 3, day: 13, title: "ロビンソン", artist: "スピッツ", url: "" },
      { month: 3, day: 20, title: "その先の週", artist: "誰か", url: "" },
    ],
    prevYearLast: { month: 12, day: 26, title: "前年最終週の曲", artist: "前年", url: "" },
    people: [],
    updatedAt: "",
  };

  // 「生まれた瞬間に1位だった曲」= 誕生日以前で最も近い週
  assert(songForBirthday({ month: 3, day: 15 }, y)?.title === "ロビンソン", "3/15 は 3/13 付の週");
  assert(songForBirthday({ month: 3, day: 13 }, y)?.title === "ロビンソン", "発表日当日はその週");
  assert(songForBirthday({ month: 3, day: 19 }, y)?.title === "ロビンソン", "次の週の前日まではその週");
  assert(songForBirthday({ month: 3, day: 20 }, y)?.title === "その先の週", "次の発表日からは次の週");
  assert(songForBirthday({ month: 12, day: 31 }, y)?.title === "その先の週", "年末は最後の週");
  // 年始生まれ（最初の週より前）は前年の最終週へフォールバック
  assert(songForBirthday({ month: 1, day: 1 }, y)?.title === "前年最終週の曲", "1/1 は前年の最終週");
  assert(songForBirthday({ month: 1, day: 2 }, y)?.title === "たぶんオーライ", "1/2 は当年の初週");
  // チャートが無い年（1968年より前）は prevYearLast も無く null
  assert(songForBirthday({ month: 5, day: 5 }, { ...y, chartWeeks: [], prevYearLast: null }) === null, "チャート無しは null");

  // できごと
  assert(eventOnBirthday(y, { month: 3, day: 15 }).length === 1, "誕生日ぴったりのできごと");
  assert(eventOnBirthday(y, { month: 3, day: 16 }).length === 0, "該当なしは空");
  const march = eventsForMonth(y, { month: 3, day: 15 });
  assert(march.length === 1 && march[0].text === "地下鉄サリン事件", "生まれた月のできごと（誕生日ぴったり分は除く）");

  // Spotify リンク: 解決済みなら曲ページ、未解決なら検索 URL（古いデータでも必ず飛べる）
  const resolved = { month: 3, day: 13, title: "ロビンソン", artist: "スピッツ", url: "", spotify: "https://open.spotify.com/track/abc123" };
  assert(spotifyUrl(resolved) === "https://open.spotify.com/track/abc123", "解決済みは曲ページ直リンク");
  const unresolved = { month: 3, day: 13, title: "ロビンソン", artist: "スピッツ", url: "" };
  assert(
    spotifyUrl(unresolved) === `https://open.spotify.com/search/${encodeURIComponent("ロビンソン スピッツ")}`,
    "未解決は曲名＋アーティストの検索 URL",
  );
  assert(!spotifyUrl(unresolved).includes(" "), "検索 URL は空白をエンコードする");
  assert(
    spotifyUrl({ month: 1, day: 1, title: "曲", artist: "", url: "" }).endsWith(encodeURIComponent("曲")),
    "アーティスト不明でも末尾に余計な空白を残さない",
  );
  console.log("[year] OK");
}

// ---- 9) 推し（K-POP・VTuber の再カット） ----
{
  const person = (name: string, desc: string): Person => ({
    name,
    nameEn: "",
    year: 2000,
    desc,
    photo: "",
    url: "",
    jaKnown: true,
    fame: 1,
  });
  const kpop = kpopOf([
    person("JUNG KOOK", "アイドル、歌手（BTS）"),
    person("ユジン", "アイドル（IVE、元IZ*ONE）"),
    person("シュファ", "アイドル（(G)I-DLE）"),
    // 部分一致の罠: "Aivery" の中の "IVE"、"KARAOKE" の中の "KARA" を拾ってはいけない
    person("諸橋姫向", "アイドル（Aivery、元NGT48）"),
    person("誰か", "KARAOKE 芸人"),
    person("山田太郎", "俳優"),
  ]);
  assert(kpop.length === 3, `K-POP は3人（実際: ${kpop.map((p) => p.name).join(",")}）`);
  assert(!kpop.some((p) => p.name === "諸橋姫向"), "Aivery を IVE と誤検出しない（単語境界）");
  assert(!kpop.some((p) => p.name === "誰か"), "KARAOKE を KARA と誤検出しない");

  const chars: Character[] = [
    { name: "叶", work: "にじさんじ" },
    { name: "アズマリム", work: "バーチャルYouTuber" },
    { name: "渋谷ハル", work: "バーチャルYoutuber" }, // 表記ゆれ（小文字 t）
    { name: "モンキー・D・ルフィ", work: "ONE PIECE" },
  ];
  const v = vtubersOf(chars);
  assert(v.length === 3, `VTuber は3人（実際: ${v.length}）`);
  assert(!v.some((c) => c.work === "ONE PIECE"), "普通のキャラは含めない");
  console.log("[oshi] OK");
}

// ---- 10) 同じ年に生まれた有名人（肩書きの分類・⭐ 完全一致） ----
{
  // 主業は肩書きの先頭に来るので、「最初にマッチした位置が早い方」で分類する。
  assert(categorize("元プロ野球選手") === "sports", "野球はスポーツ");
  assert(categorize("フィギュアスケート選手") === "sports", "スケートはスポーツ");
  assert(categorize("アイドル、歌手（SixTONES）") === "ent", "アイドルが先なら芸能（歌手より前）");
  assert(categorize("歌手、俳優") === "music", "歌手が先なら音楽（俳優より前）");
  assert(categorize("元アナウンサー、タレント") === "ent", "アナウンサーは芸能");
  assert(categorize("元サッカー選手、指導者") === "sports", "元サッカー選手はスポーツ");
  assert(categorize("漫画家") === "culture", "漫画家は文化");
  assert(categorize("シンガーソングライター") === "music", "シンガーは音楽");
  assert(categorize("政治家") === "other", "政治家はその他");
  assert(categorize("") === "other", "肩書き無しはその他");
  // 「陸上」だけだと陸上自衛官を拾ってしまうので「陸上競技」で見ている
  assert(categorize("陸上自衛官") === "other", "陸上自衛官をスポーツにしない");
  assert(categorize("陸上競技選手") === "sports", "陸上競技はスポーツ");

  const yp = (name: string, desc: string, month = 6, day = 18): YearPerson => ({
    name,
    month,
    day,
    desc,
    photo: "",
    url: `https://ja.wikipedia.org/wiki/${name}`,
  });
  const groups = groupByCat([yp("松村北斗", "アイドル、俳優"), yp("南野拓実", "サッカー選手"), yp("あいみょん", "歌手")]);
  assert(groups.get("ent")!.length === 1 && groups.get("ent")![0].name === "松村北斗", "芸能に分配");
  assert(groups.get("sports")!.length === 1, "スポーツに分配");
  assert(groups.get("music")!.length === 1, "音楽に分配");
  assert(groups.get("culture")!.length === 0, "該当なしのカテゴリは空配列（キーは常にある）");

  // ⭐ は日別データ（全件持っている）から引く。年側の上限で切られた人も拾えるように。
  const person = (name: string, year: number): Person => ({
    name,
    nameEn: "",
    year,
    desc: "俳優",
    photo: "",
    url: `https://ja.wikipedia.org/wiki/${name}`,
    jaKnown: true,
    fame: 1,
  });
  const dayPeople = [person("松村北斗", 1995), person("誰か", 1980)];
  const exact = exactMatchesOf(dayPeople, 1995);
  assert(exact.length === 1 && exact[0].name === "松村北斗", "生年月日まで一致する人だけ");
  assert(exactMatchesOf(dayPeople, 1999).length === 0, "同い年がいなければ空");

  // ⭐ に出した人はカテゴリ側から除く（同じセクションでの二重表示を防ぐ）
  const rest = withoutExact([yp("松村北斗", "アイドル、俳優"), yp("南野拓実", "サッカー選手")], exact);
  assert(rest.length === 1 && rest[0].name === "南野拓実", "⭐ の人はカテゴリ側から除かれる");
  console.log("[peers] OK");
}

console.log("\n✅ smoketest passed");
