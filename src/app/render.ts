// 結果セクションの HTML 文字列ビルダ群（DOM への流し込みは main.ts）。
// すべてのデータ由来テキストは esc() でエスケープする。
import type { Anniversary, Character, DayData, DayEvent, Person } from "../lib/types";
import {
  ageOf,
  birthFlowerOf,
  birthstoneOf,
  etoOf,
  generationOf,
  warekiOf,
  zodiacOf,
  type YMD,
} from "../lib/almanac";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 英語名（無ければ日本語名）からイニシャル 1〜2 文字。 */
export function initials(person: Person): string {
  const en = person.nameEn?.trim();
  if (en) {
    const parts = en.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase();
  }
  return person.name.slice(0, 1);
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

  const facts: { k: string; v: string; sub?: string }[] = [
    { k: "いまの年齢", v: age >= 0 ? `${age}歳` : "—", sub: wareki ? `${wareki.label}生まれ` : undefined },
    { k: "星座", v: `${z.emoji} ${z.name}`, sub: z.range },
    { k: "干支", v: `${eto.emoji} ${eto.name}年`, sub: `${eto.animal}` },
    { k: "誕生石", v: stone },
    { k: "誕生花（月）", v: flower.flower, sub: flower.meaning },
    { k: "世代", v: gen || "—" },
  ];

  const cells = facts
    .map(
      (f) =>
        `<div class="fact"><div class="k">${esc(f.k)}</div><div class="v">${esc(f.v)}</div>${
          f.sub ? `<div class="sub">${esc(f.sub)}</div>` : ""
        }</div>`,
    )
    .join("");
  return section("✨", "あなたの誕生日プロフィール", `<div class="summary-grid">${cells}</div>`);
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

function personCard(p: Person, opts?: { hideFlag?: boolean }): string {
  const ini = esc(initials(p));
  const thumb = p.photo
    ? `<div class="thumb" data-initials="${ini}"><img class="photo" src="${esc(p.photo)}" alt="${esc(
        p.name,
      )}" loading="lazy" decoding="async" onerror="this.remove()" /></div>`
    : `<div class="thumb" data-initials="${ini}"></div>`;
  const meta = p.year > 0 ? `${p.year}年生まれ` : "生年非公表";
  const flag = !opts?.hideFlag && p.jaKnown ? `<span class="ja-flag">日本でも有名</span>` : "";
  const inner = `${thumb}<div class="body"><div class="name">${esc(p.name)}</div><div class="meta">${esc(
    meta,
  )}${p.desc ? ` ・ ${esc(p.desc)}` : ""}</div>${flag}</div>`;
  return p.url
    ? `<a class="pcard" href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="pcard">${inner}</div>`;
}

/* ---------- 動物・名馬 ---------- */
export function animalsHtml(animals: Person[]): string {
  if (!animals || animals.length === 0) return ""; // 動物がいない日／旧データはセクションごと非表示
  const cards = animals.map((a) => personCard(a, { hideFlag: true })).join("");
  return section("🐎", "同じ誕生日の動物・名馬", `<div class="people-grid">${cards}</div>`, animals.length);
}

/* ---------- フィクションキャラ ---------- */
export function charactersHtml(chars: Character[]): string {
  if (chars.length === 0) {
    return section("🦸", "同じ誕生日のキャラ", `<p class="empty">登録キャラに同じ誕生日はいませんでした。</p>`);
  }
  const list = chars.map(charChip).join("");
  return section("🦸", "同じ誕生日のキャラ", `<div class="char-list">${list}</div>`, chars.length);
}

function charChip(c: Character): string {
  const dot = `<span class="dot" style="background:${esc(c.color ?? "#8b5cf6")}"></span>`;
  const inner = `${dot}<span class="cname">${esc(c.name)}</span><span class="cwork">${esc(c.work)}</span>`;
  return c.url
    ? `<a class="chip" href="${esc(c.url)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="chip">${inner}</div>`;
}

/* ---------- 今日は何の日 ---------- */
export function anniversaryHtml(anniversaries: Anniversary[], events: DayEvent[]): string {
  if (anniversaries.length === 0 && events.length === 0) {
    return section("📅", "今日は何の日", `<p class="empty">データが見つかりませんでした。</p>`);
  }
  const chips = anniversaries
    .map((a) => `<span class="anniv" title="${esc(a.desc ?? "")}">${esc(a.label)}</span>`)
    .join("");
  const evs = events.length
    ? `<ul class="events">${events
        .map((e) => `<li><span class="yr">${e.year}年</span><span>${esc(e.text)}</span></li>`)
        .join("")}</ul>`
    : "";
  const body = `${chips ? `<div class="anniv-list">${chips}</div>` : ""}${evs}`;
  return section("📅", "今日は何の日", body);
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
function section(emoji: string, title: string, body: string, count?: number): string {
  const c = count != null ? `<span class="count">${count}件</span>` : "";
  return `<section class="section"><h2><span class="emoji">${emoji}</span>${esc(title)}${c}</h2>${body}</section>`;
}

export function loadingHtml(): string {
  return `<p class="loading">🎂 さがしています…</p>`;
}

export function errorHtml(msg: string): string {
  return `<p class="error-msg">${esc(msg)}</p>`;
}

/** 結果全体（データ取得後）。 */
export function resultHtml(input: YMD, today: YMD, day: DayData): string {
  return (
    headerHtml(input) +
    summaryHtml(input, today) +
    peopleHtml(day.people) +
    animalsHtml(day.animals) +
    charactersHtml(day.characters) +
    anniversaryHtml(day.anniversaries, day.events) +
    shareHtml()
  );
}
