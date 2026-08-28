// 結果セクションの HTML 文字列ビルダ群（DOM への流し込みは main.ts）。
// すべてのデータ由来テキストは esc() でエスケープする。
import type { Anniversary, Character, ChartWeek, DayData, DayEvent, Game, Person, YearData, YearPerson } from "../lib/types";
import { mergeAnniversaries } from "../lib/anniv";
import { exactGamesOf, gameLink, withoutExactGames } from "../lib/games";
import { eventOnBirthday, eventsForMonth, songForBirthday, spotifyUrl } from "../lib/year";
import {
  CAT_LABELS,
  CAT_ORDER,
  categorize,
  cohortLabel,
  cohortYearOf,
  exactMatchesOf,
  groupByCat,
  withoutExact,
} from "../lib/peers";
import {
  ageOf,
  birthFlowerOf,
  birthstoneOf,
  daysLivedOf,
  etoOf,
  generationOf,
  kyuseiOf,
  lifePathOf,
  moonAgeOf,
  nextMilestoneOf,
  warekiOf,
  weekdayOf,
  zodiacOf,
  type YMD,
} from "../lib/almanac";
import { kpopOf, vtubersOf } from "../lib/oshi";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 写真が無いカードのイニシャル 2 文字。写真は日本の存命の有名人ほど無い（自由ライセンスの
 * 画像が Wikipedia に無いため）ので、これはレアケースではなく一覧の 4 割に出る**主要な見た目**。
 *
 *   「今田美桜」  → 今田      （漢字名は先頭2文字＝だいたい姓）
 *   「ゲオルク・オーム」→ ゲオ  （中黒つきは各セグメントの頭1字）
 *   「Ada Lovelace」→ AL      （nameEn があれば姓名の頭文字。現状 nameEn は常に空）
 */
export function initials(person: { name: string; nameEn?: string }): string {
  const en = person.nameEn?.trim();
  if (en) {
    const parts = en.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase();
  }
  const name = person.name.trim();
  const segs = name.split(/[・･\s]+/).filter(Boolean);
  if (segs.length > 1) return segs[0][0] + segs[1][0];
  return [...name].slice(0, 2).join(""); // サロゲートペア対策で配列化
}

/* ---------- 結果ヘッダ ---------- */
export function headerHtml(input: YMD): string {
  return `<div class="result-head"><div class="date-big"><em>${input.month}月${input.day}日</em>生まれ</div></div>`;
}

/* ---------- サマリー（占い・暦） ---------- */
export function summaryHtml(input: YMD, today: YMD): string {
  const z = zodiacOf(input);
  const stone = birthstoneOf(input.month);
  const flower = birthFlowerOf(input.month);
  const eto = etoOf(input.year);
  const wareki = warekiOf(input);
  const gen = generationOf(input.year);
  const age = ageOf(input, today);

  const facts: Fact[] = [
    { k: "いまの年齢", v: age >= 0 ? `${age}歳` : "—", sub: wareki ? `${wareki.label}生まれ` : undefined },
    { k: "星座", v: `${z.emoji} ${z.name}`, sub: z.range },
    { k: "干支", v: `${eto.emoji} ${eto.name}年`, sub: `${eto.animal}` },
    { k: "誕生石", v: stone },
    { k: "誕生花（月）", v: flower.flower, sub: flower.meaning },
    { k: "世代", v: gen || "—" },
  ];

  return section("✨", "あなたの誕生日プロフィール", factsGrid(facts));
}

/* ---------- 誕生日の小ネタ ---------- */
export function funFactsHtml(input: YMD, today: YMD): string {
  const wd = weekdayOf(input);
  const moon = moonAgeOf(input);
  const lived = daysLivedOf(input, today);
  const next = nextMilestoneOf(input, today);
  const life = lifePathOf(input);
  const kyusei = kyuseiOf(input);

  const facts: Fact[] = [
    { k: "生まれた曜日", v: `${wd.emoji} ${wd.name}` },
    { k: "生まれた日の月", v: `${moon.emoji} ${moon.phase}`, sub: `月齢 ${moon.age}（概算）` },
    { k: "生まれてから", v: lived >= 0 ? `${comma(lived)}日目` : "—" },
    {
      k: "次のキリ番記念日",
      v: next ? `${comma(next.days)}日目` : "—",
      sub: next ? `${next.date.year}/${next.date.month}/${next.date.day}・あと${comma(next.daysUntil)}日` : undefined,
    },
    { k: "数秘（ライフパス）", v: String(life.number), sub: life.label },
    { k: "九星（本命星）", v: kyusei.star, sub: `五行は「${kyusei.element}」` },
  ];
  return section("🔮", "誕生日の小ネタ", factsGrid(facts));
}

interface Fact {
  k: string;
  v: string;
  sub?: string;
}

/** 3桁区切り（toLocaleString は環境で揺れるので自前）。 */
function comma(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function factsGrid(facts: Fact[]): string {
  const cells = facts
    .map(
      (f) =>
        `<div class="fact"><div class="k">${esc(f.k)}</div><div class="v">${esc(f.v)}</div>${
          f.sub ? `<div class="sub">${esc(f.sub)}</div>` : ""
        }</div>`,
    )
    .join("");
  return `<div class="summary-grid">${cells}</div>`;
}

/* ---------- 生まれた年 ---------- */
/** 生まれた月のできごとの表示上限。 */
const MONTH_EVENTS_VISIBLE = 6;
const HIGHLIGHTS_VISIBLE = 5;

export function bornYearHtml(input: YMD, year: YearData | null): string {
  if (!year) return "";
  const song = songForBirthday(input, year);
  const onBirthday = eventOnBirthday(year, input);
  const monthEvents = eventsForMonth(year, input).slice(0, MONTH_EVENTS_VISIBLE);
  const highlights = year.highlights.slice(0, HIGHLIGHTS_VISIBLE);
  if (!song && !onBirthday.length && !monthEvents.length && !highlights.length) return "";

  const songBlock = song
    ? `<div class="song">
        <div class="song-k">生まれた週のオリコン1位</div>
        ${song.cover ? `<img class="song-cover" src="${esc(song.cover)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />` : ""}
        <div class="song-title">${
          song.url
            ? `<a href="${esc(song.url)}" target="_blank" rel="noopener">${esc(song.title)}</a>`
            : esc(song.title)
        }</div>
        <div class="song-meta">${esc(song.artist)}${song.artist ? " ・ " : ""}${song.month}/${song.day} 付</div>
        <a class="song-spotify" href="${esc(spotifyUrl(song))}" target="_blank" rel="noopener">🎧 Spotifyで聴く</a>
      </div>`
    : "";

  const birthdayBlock = onBirthday.length
    ? `<div class="year-block"><h3>あなたが生まれたその日</h3><ul class="year-events">${onBirthday
        .map((e) => `<li>${esc(e.text)}</li>`)
        .join("")}</ul></div>`
    : "";

  const monthBlock = monthEvents.length
    ? `<div class="year-block"><h3>${input.month}月のできごと</h3><ul class="year-events">${monthEvents
        .map((e) => `<li><span class="yr">${e.month}/${e.day}</span><span>${esc(e.text)}</span></li>`)
        .join("")}</ul></div>`
    : "";

  const highlightBlock = highlights.length
    ? `<div class="year-block"><h3>${year.year}年の主な出来事</h3><ul class="year-events">${highlights
        .map((h) => `<li>${esc(h)}</li>`)
        .join("")}</ul></div>`
    : "";

  const credit = `<p class="credit">出典: 日本語版Wikipedia「${year.year}年」／オリコン週間シングルチャート第1位</p>`;
  return section(
    "🎂",
    `あなたが生まれた年（${year.year}年）`,
    `${songBlock}${chartListHtml(year, song)}${birthdayBlock}${monthBlock}${highlightBlock}${credit}`,
  );
}

/**
 * その年の週間1位ぜんぶ（ネスト details・初期閉）。
 * 誕生週の判定は**参照比較**——songForBirthday は chartWeeks の要素そのものか prevYearLast を
 * 返すので、month/day 比較だと年始生まれ（song=前年末週）で当年の同月日週を誤ハイライトする。
 * 参照比較なら prevYearLast は一覧に無い＝自然にハイライト無しに落ちる。
 */
function chartListHtml(year: YearData, song: ChartWeek | null): string {
  if (!year.chartWeeks.length) return "";
  const rows = year.chartWeeks
    .map((w) => {
      const isBirth = w === song;
      const img = w.cover
        ? `<img class="cw-img" src="${esc(w.cover)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />`
        : "";
      const title = w.url
        ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>`
        : esc(w.title);
      return `<li class="cw${isBirth ? " is-birth" : ""}"><span class="cw-date">${w.month}/${w.day}</span><span class="cw-art">${img}</span><span class="cw-song"><span class="cw-title">${title}</span><span class="cw-artist">${esc(w.artist)}</span></span>${isBirth ? `<span class="cw-badge">生まれた週</span>` : ""}<a class="cw-listen" href="${esc(spotifyUrl(w))}" target="_blank" rel="noopener" aria-label="Spotifyで聴く">🎧</a></li>`;
    })
    .join("");
  return `<details class="chart-list"><summary>📈 ${year.year}年の週間1位をぜんぶ見る（${year.chartWeeks.length}週）</summary><ol class="chart-weeks">${rows}</ol></details>`;
}

/* ---------- 有名人 ---------- */
/** 初期表示件数。これを超える分は「もっと見る」で展開。 */
const PEOPLE_VISIBLE = 30;

export function peopleHtml(people: Person[]): string {
  if (people.length === 0) {
    return section("🎤", "同じ誕生日の有名人", `<p class="empty">この日のデータが見つかりませんでした。</p>`);
  }
  const visible = people.slice(0, PEOPLE_VISIBLE).map((p) => personCard(p)).join("");
  // 残りは「もっと見る」クリック時に main.ts が peopleMoreHtml で遅延描画（初期 DOM を軽く保つ）。
  const restCount = Math.max(0, people.length - PEOPLE_VISIBLE);
  const more = restCount
    ? `<button class="more-btn" data-action="show-more-people">もっと見る（＋${restCount}人）</button>`
    : "";
  const body = `<div class="people-grid" data-people-grid>${visible}</div>
    ${more}
    <p class="credit">顔写真・プロフィール: Wikipedia / Wikimedia Commons（各カードは出典記事にリンク）</p>`;
  return section("🎤", "同じ誕生日の有名人", body, people.length);
}

/** 「もっと見る」で追加描画する残りカード（先頭 PEOPLE_VISIBLE 件を除く）。 */
export function peopleMoreHtml(people: Person[]): string {
  return people.slice(PEOPLE_VISIBLE).map((p) => personCard(p)).join("");
}

/**
 * カード 1 枚。meta 行の前置き（「1995年生まれ」「6/18生まれ」）だけ呼び出し側で決める。
 *
 * サムネはイニシャルを背面に置き、写真があれば上から被せる（読み込み失敗時は onerror で img を
 * 消すとイニシャルが現れる）。写真が無いカードは一覧の 4 割に達するので、肩書きのカテゴリで
 * 色を変えて「壊れている」ではなく「分類された色」に見せる（data-cat を CSS が拾う）。
 */
function cardHtml(p: { name: string; nameEn?: string; desc: string; photo: string; url: string }, meta: string): string {
  const ini = esc(initials(p));
  const cat = categorize(p.desc);
  const thumb = p.photo
    ? `<div class="thumb" data-cat="${cat}" data-initials="${ini}"><img class="photo" src="${esc(
        p.photo,
      )}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.remove()" /></div>`
    : `<div class="thumb" data-cat="${cat}" data-initials="${ini}"></div>`;
  const inner = `${thumb}<div class="body"><div class="name">${esc(p.name)}</div><div class="meta">${esc(
    meta,
  )}${p.desc ? ` ・ ${esc(p.desc)}` : ""}</div></div>`;
  return p.url
    ? `<a class="pcard" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="pcard">${inner}</div>`;
}

function personCard(p: Person): string {
  return cardHtml(p, p.year > 0 ? `${p.year}年生まれ` : "生年非公表");
}

/* ---------- 推し（K-POPアイドル・VTuber） ---------- */
const KPOP_VISIBLE = 12;
const VTUBER_VISIBLE = 24;

/**
 * 有名人一覧とキャラ一覧に埋もれている「推し」を拾い直すハイライト。
 * 元のセクションからは除いていないので、全件はそちらで見られる。
 */
export function oshiHtml(people: Person[], chars: Character[]): string {
  const kpop = kpopOf(people);
  const vtubers = vtubersOf(chars);
  if (kpop.length === 0 && vtubers.length === 0) return "";

  const kpopBlock = kpop.length
    ? `<div class="oshi-block"><h3>K-POPアイドル${
        kpop.length > KPOP_VISIBLE ? `（上位${KPOP_VISIBLE}人／${kpop.length}人）` : `（${kpop.length}人）`
      }</h3><div class="people-grid">${kpop.slice(0, KPOP_VISIBLE).map(personCard).join("")}</div></div>`
    : "";

  const vtuberBlock = vtubers.length
    ? `<div class="oshi-block"><h3>VTuber${
        vtubers.length > VTUBER_VISIBLE ? `（先頭${VTUBER_VISIBLE}人／${vtubers.length}人）` : `（${vtubers.length}人）`
      }</h3><div class="char-list">${vtubers.slice(0, VTUBER_VISIBLE).map((c) => charChip(c)).join("")}</div>${
        vtubers.length > VTUBER_VISIBLE
          ? `<p class="credit">残りは「同じ誕生日のキャラ」の一覧に含まれています。</p>`
          : ""
      }</div>`
    : "";

  return section("🎙", "同じ誕生日の推し", `${kpopBlock}${vtuberBlock}`, kpop.length + vtubers.length);
}

/* ---------- 同じ学年の有名人 ---------- */
/** カテゴリブロックの初期表示件数。これを超える分は「もっと見る」で展開。 */
const YEAR_PEOPLE_VISIBLE = 12;

function yearPersonCard(p: YearPerson): string {
  // 学年は暦年をまたぐので年まで出す（早生まれが見て分かる）。
  return cardHtml(p, `${p.year}/${p.month}/${p.day}生まれ`);
}

/**
 * 同学年（年度＝4/2〜翌4/1 生まれ）の有名人を、肩書きからのカテゴリ別に並べる。
 * cohort は入力の学年に対応する年ファイル（早生まれなら暦年の1つ前）。
 * 先頭には「生年月日まで完全に同じ」人を出し、その人はカテゴリ側からは除く（二重表示の防止）。
 */
export function sameYearHtml(input: YMD, day: DayData, cohort: YearData | null): string {
  const exact = exactMatchesOf(day.people, input.year);
  const rest = cohort ? withoutExact(cohort.people, exact) : [];
  if (exact.length === 0 && rest.length === 0) return "";

  const exactBlock = exact.length
    ? `<div class="year-people-block exact"><h3>⭐ 生年月日まで完全に同じ！（${exact.length}人）</h3><div class="people-grid">${exact
        .map((p) => cardHtml(p, `${input.year}/${input.month}/${input.day}生まれ`))
        .join("")}</div></div>`
    : "";

  const groups = groupByCat(rest);
  const catBlocks = CAT_ORDER.map((cat) => {
    const list = groups.get(cat) ?? [];
    if (list.length === 0) return "";
    const visible = list.slice(0, YEAR_PEOPLE_VISIBLE).map(yearPersonCard).join("");
    // 残りは「もっと見る」クリック時に more.ts が yearPeopleMoreHtml で遅延描画（カテゴリごとに独立）。
    const restCount = Math.max(0, list.length - YEAR_PEOPLE_VISIBLE);
    const more = restCount
      ? `<button class="more-btn" data-action="show-more-year-people" data-cat="${cat}">もっと見る（＋${restCount}人）</button>`
      : "";
    const head = restCount
      ? `${CAT_LABELS[cat]}（${list.length}人中${YEAR_PEOPLE_VISIBLE}人）`
      : `${CAT_LABELS[cat]}（${list.length}人）`;
    return `<div class="year-people-block"><h3>${esc(head)}</h3><div class="people-grid" data-year-grid="${cat}">${visible}</div>${more}</div>`;
  }).join("");

  const cohortYear = cohortYearOf(input);
  const credit = `<p class="credit">学年は 4月2日〜翌4月1日 生まれで区切っています（4月1日生まれは早生まれ＝1つ上の学年）。出典は日本語版Wikipedia の各「M月D日」記事（人気＝年間閲覧数の順）。</p>`;
  return section(
    "🎓",
    `同じ学年の有名人（${cohortLabel(cohortYear)}生まれ）`,
    `${exactBlock}${catBlocks}${credit}`,
    exact.length + rest.length,
  );
}

/** 「もっと見る」で追加描画する残りカード（そのカテゴリの先頭 YEAR_PEOPLE_VISIBLE 件を除く）。 */
export function yearPeopleMoreHtml(people: YearPerson[], cat: string): string {
  return people
    .filter((p) => categorize(p.desc) === cat)
    .slice(YEAR_PEOPLE_VISIBLE)
    .map(yearPersonCard)
    .join("");
}

/* ---------- 動物・名馬 ---------- */
export function animalsHtml(animals: Person[]): string {
  if (!animals || animals.length === 0) return ""; // 動物がいない日／旧データはセクションごと非表示
  const cards = animals.map((a) => personCard(a)).join("");
  return section("🐎", "同じ誕生日の動物・名馬", `<div class="people-grid">${cards}</div>`, animals.length);
}

/* ---------- フィクションキャラ ---------- */
/** 初期表示件数。これを超える分は「もっと見る」で展開（日によっては数百〜千件あるため）。 */
const CHARS_VISIBLE = 40;

export function charactersHtml(chars: Character[]): string {
  if (chars.length === 0) {
    return section("🦸", "同じ誕生日のキャラ", `<p class="empty">登録キャラに同じ誕生日はいませんでした。</p>`);
  }
  const visible = charRows(chars.slice(0, CHARS_VISIBLE), null);
  // 残りは「もっと見る」クリック時に main.ts が charactersMoreHtml で遅延描画（初期 DOM を軽く保つ）。
  const restCount = Math.max(0, chars.length - CHARS_VISIBLE);
  const more = restCount
    ? `<button class="more-btn" data-action="show-more-chars">もっと見る（＋${restCount}件）</button>`
    : "";
  const body = `<div class="char-list" data-char-list>${visible}</div>${more}`;
  return section("🦸", "同じ誕生日のキャラ", body, chars.length);
}

/**
 * 「もっと見る」で追加描画する残り（先頭 CHARS_VISIBLE 件を除く）。
 * 境界で作品が続く場合に見出しを重複させないよう、直前の作品名を引き継ぐ。
 */
export function charactersMoreHtml(chars: Character[]): string {
  return charRows(chars.slice(CHARS_VISIBLE), chars[CHARS_VISIBLE - 1]?.work ?? null);
}

/**
 * キャラ一覧は作品の人気順ソートで同一作品が隣接している（aggregate の rankCharacters）ので、
 * 作品が変わる行の前に見出しを差し込むだけでグループ表示になる。チップ側の作品名表示は省く
 * （1行ごとに作品名を繰り返さない）。
 */
function charRows(chars: Character[], prevWork: string | null): string {
  let prev = prevWork;
  const rows: string[] = [];
  for (const c of chars) {
    if (c.work !== prev) {
      rows.push(`<div class="char-work-head">${esc(c.work || "その他")}</div>`);
      prev = c.work;
    }
    rows.push(charChip(c, false));
  }
  return rows.join("");
}

/**
 * キャラ 1 件。画像（AniList 直リンク）があれば色ドットの位置に 32px 角サムネを重ねる。
 * ドットを背面に残したまま img を被せるので、読み込み失敗（onerror で除去）時は色ドットに戻る。
 */
function charChip(c: Character, withWork = true): string {
  const img = c.image
    ? `<img class="cimg" src="${esc(c.image)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" />`
    : "";
  const dot = `<span class="dot${img ? " has-img" : ""}" style="background:${esc(c.color ?? "#8b5cf6")}">${img}</span>`;
  const work = withWork ? `<span class="cwork">${esc(c.work)}</span>` : "";
  const inner = `${dot}<span class="cname">${esc(c.name)}</span>${work}`;
  return c.url
    ? `<a class="chip" href="${esc(c.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="chip">${inner}</div>`;
}

/* ---------- M月D日は何の日 ---------- */
// 「今日」ではなく選択した誕生日の記念日・できごとなので、見出しに日付を入れる。
// Wikipedia（anniversaries）と日本記念日協会（kinenbi）は別キーで受けて表示時にマージする。
export function anniversaryHtml(
  input: YMD,
  anniversaries: Anniversary[],
  kinenbi: Anniversary[],
  events: DayEvent[],
): string {
  const title = `${input.month}月${input.day}日は何の日`;
  const merged = mergeAnniversaries(anniversaries, kinenbi);
  if (merged.length === 0 && events.length === 0) {
    return section("📅", title, `<p class="empty">データが見つかりませんでした。</p>`);
  }
  // url あり＝協会の由来ページへ新しいタブでリンク（由来本文はコピーしない）。charChip と同じ分岐流儀。
  const chips = merged
    .map((a) =>
      a.url
        ? `<a class="anniv" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.desc ?? "")}">${esc(a.label)}</a>`
        : `<span class="anniv" title="${esc(a.desc ?? "")}">${esc(a.label)}</span>`,
    )
    .join("");
  const evs = events.length
    ? `<ul class="events">${events
        .map((e) => `<li><span class="yr">${e.year}年</span><span>${esc(e.text)}</span></li>`)
        .join("")}</ul>`
    : "";
  const body = `${chips ? `<div class="anniv-list">${chips}</div>` : ""}${evs}`;
  return section("📅", title, body, merged.length || undefined);
}

/* ---------- 同じ誕生日に発売されたゲーム ---------- */
/** 月日一覧の初期表示件数。これを超える分は「もっと見る」で展開。 */
const GAMES_VISIBLE = 30;

function gameRow(g: Game): string {
  const href = gameLink(g);
  const label = `<span class="g-year">${g.year}</span><span class="g-name">${esc(g.name)}</span><span class="g-plat">${esc(
    g.platform,
  )}</span>`;
  // 記念日チップ・charChip と同じ分岐流儀（url があれば a、無ければ span）。
  return href
    ? `<li class="grow"><a href="${esc(href)}" target="_blank" rel="noopener">${label}</a></li>`
    : `<li class="grow"><span>${label}</span></li>`;
}

/**
 * その月日に発売されたゲーム。生年まで一致するもの（⭐）を先頭に出し、
 * 残りは人気（日本語版Wikipedia の年間閲覧数）順で先頭 GAMES_VISIBLE 件＋「もっと見る」。
 * 誕生日と発売日がピタリ一致する確率は 2〜5 割なので、⭐ が無い日でも月日一覧で必ず中身が出る。
 */
export function gamesHtml(input: YMD, games: Game[]): string {
  if (games.length === 0) return "";
  const exact = exactGamesOf(games, input.year);
  const rest = withoutExactGames(games, exact);

  const exactBlock = exact.length
    ? `<div class="game-block exact"><h3>⭐ あなたが生まれた日に発売（${exact.length}本）</h3><ol class="game-list">${exact
        .map(gameRow)
        .join("")}</ol></div>`
    : "";

  const visible = rest.slice(0, GAMES_VISIBLE).map(gameRow).join("");
  const restCount = Math.max(0, rest.length - GAMES_VISIBLE);
  const more = restCount
    ? `<button class="more-btn" data-action="show-more-games">もっと見る（＋${restCount}本）</button>`
    : "";
  const restBlock = rest.length
    ? `<div class="game-block"><h3>${input.month}月${input.day}日に発売されたゲーム${
        restCount ? `（${rest.length}本中${GAMES_VISIBLE}本）` : `（${rest.length}本）`
      }</h3><ol class="game-list" data-games-list>${visible}</ol>${more}</div>`
    : "";

  const credit = `<p class="credit">出典: 日本語版Wikipedia の機種別「ゲームタイトル一覧」／PC は <a href="https://store.steampowered.com/" target="_blank" rel="noopener">Steam</a>（人気＝記事の年間閲覧数の順）</p>`;
  return section("🎮", "同じ誕生日に発売されたゲーム", `${exactBlock}${restBlock}${credit}`, games.length);
}

/** 「もっと見る」で追加描画する残り（⭐を除いた一覧の先頭 GAMES_VISIBLE 件より後ろ）。 */
export function gamesMoreHtml(games: Game[]): string {
  return games.slice(GAMES_VISIBLE).map(gameRow).join("");
}

/* ---------- 共有 ---------- */
export function shareHtml(): string {
  return section(
    "📣",
    "シェアして盛り上がる",
    `<div class="share-row">
      <button class="share-btn x" data-action="share-x">𝕏 でシェア</button>
      <button class="share-btn copy" data-action="copy-link">🔗 リンクをコピー</button>
    </div>`,
  );
}

/* ---------- 共通 ---------- */
// 折りたたみ（初期は全閉）。class="section" は more.ts の .closest(".section") が依存するので維持。
// シェブロンは ::after ではなく明示 span——count の margin-left:auto と共存させるため（CSS の .count + .chev 参照）。
function section(emoji: string, title: string, body: string, count?: number): string {
  const c = count != null ? `<span class="count">${count}件</span>` : "";
  return `<details class="section"><summary><h2><span class="emoji">${emoji}</span>${esc(title)}${c}<span class="chev" aria-hidden="true"></span></h2></summary><div class="section-body">${body}</div></details>`;
}

export function loadingHtml(): string {
  return `<p class="loading">🎂 さがしています…</p>`;
}

export function errorHtml(msg: string): string {
  return `<p class="error-msg">${esc(msg)}</p>`;
}

/**
 * 結果全体（データ取得後）。取得失敗/未生成なら null（セクションごと非表示）。
 * year は**暦年**（できごと・オリコン）、cohort は**学年**（同学年の有名人）のファイル。
 * 早生まれだと別ファイルになるので分けて受ける（main.ts が両方 fetch する）。
 */
export function resultHtml(
  input: YMD,
  today: YMD,
  day: DayData,
  year: YearData | null = null,
  cohort: YearData | null = null,
): string {
  return (
    headerHtml(input) +
    summaryHtml(input, today) +
    funFactsHtml(input, today) +
    bornYearHtml(input, year) +
    // 記念日は飲み会ネタとして鮮度が高いのに、数百件のキャラ一覧の下だと誰も辿り着けないのでここに置く。
    anniversaryHtml(input, day.anniversaries, day.kinenbi, day.events) +
    gamesHtml(input, day.games) +
    peopleHtml(day.people) +
    oshiHtml(day.people, day.characters) +
    sameYearHtml(input, day, cohort) +
    animalsHtml(day.animals) +
    charactersHtml(day.characters) +
    shareHtml()
  );
}
