// DOM スモークテスト: boot → 入力 → fetch(スタブ) → セクション描画 → ?d= 同期 → 共有URL復元。
// 実行: npx tsx scripts/domtest.ts
import { JSDOM } from "jsdom";
import type { DayData, YearData } from "../src/lib/types";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
}

const SAMPLE: DayData = {
  date: "03-15",
  people: [
    {
      name: "ポール・ポグバ",
      nameEn: "Paul Pogba",
      year: 1993,
      desc: "フランスのサッカー選手",
      photo: "https://upload.wikimedia.org/x.jpg",
      url: "https://ja.wikipedia.org/wiki/Pogba",
      jaKnown: true,
      fame: 93,
    },
    {
      name: "Some Person",
      nameEn: "Some Person",
      year: 1970,
      desc: "American actor",
      photo: "",
      url: "",
      jaKnown: false,
      fame: 12,
    },
  ],
  animals: [],
  characters: [{ name: "テストキャラ", work: "TEST", color: "#ff0000" }],
  anniversaries: [{ label: "靴の記念日", desc: "日本記念日協会" }, { label: "サイコの日" }],
  events: [{ year: 2013, text: "新幹線200系電車引退。" }],
  updatedAt: "2026-06-30T00:00:00Z",
};

const SAMPLE_YEAR: YearData = {
  year: 1995,
  events: [
    { month: 3, day: 15, text: "誕生日ぴったりのできごと" },
    { month: 3, day: 20, text: "地下鉄サリン事件" },
  ],
  highlights: ["阪神淡路大震災"],
  chartWeeks: [{ month: 3, day: 13, title: "ロビンソン", artist: "スピッツ", url: "https://ja.wikipedia.org/wiki/x" }],
  prevYearLast: null,
  updatedAt: "2026-06-30T00:00:00Z",
};

/** URL で per-day / per-year を出し分けるフェイク fetch。 */
function fakeFetch(day: DayData, year: YearData | null = SAMPLE_YEAR) {
  return async (url: string) => {
    if (String(url).includes("/data/years/")) {
      if (!year) return { ok: false, json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => year } as unknown as Response;
    }
    return { ok: true, json: async () => day } as unknown as Response;
  };
}

function appHtml(): string {
  const opt = (n: number) => `<option value="${n}">${n}</option>`;
  const years = [1970, 1993, 1995, 2000, 2003].map(opt).join("");
  const months = Array.from({ length: 12 }, (_, i) => opt(i + 1)).join("");
  const daysO = Array.from({ length: 31 }, (_, i) => opt(i + 1)).join("");
  return `<!DOCTYPE html><body><main id="app">
    <form class="bday-form" id="bday-form">
      <select id="in-year">${years}</select>
      <select id="in-month">${months}</select>
      <select id="in-day">${daysO}</select>
      <button type="submit" data-action="diagnose">調べる</button>
    </form>
    <div id="result"></div>
  </main></body>`;
}

function setupDom(url: string): JSDOM {
  const dom = new JSDOM(appHtml(), { url, pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.location = dom.window.location;
  g.history = dom.window.history;
  // navigator は Node 21+ では globalThis に読み取り専用で存在するため代入しない
  // （main.ts は navigator.clipboard を optional chaining で参照するだけで、テスト対象外）。
  // fetch をスタブ（per-day は SAMPLE、per-year は SAMPLE_YEAR）
  g.fetch = fakeFetch(SAMPLE);
  return dom;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setSelect(root: Element, id: string, val: string): void {
  (root.querySelector(id) as HTMLSelectElement).value = val;
}
function submit(dom: JSDOM, root: Element): void {
  root
    .querySelector("#bday-form")!
    .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
}

// ---- 1) 通常フロー: 入力 → 描画 → URL 同期 ----
{
  const dom = setupDom("https://example.com/samesaengil/");
  const { boot } = await import("../src/app/main");
  const root = dom.window.document.getElementById("app")!;
  boot(root as unknown as HTMLElement);

  assert(!!root.querySelector("#in-year"), "年セレクトがある");
  assert(root.querySelector("#result")!.innerHTML === "", "初期は結果空");

  setSelect(root, "#in-year", "1995");
  setSelect(root, "#in-month", "3");
  setSelect(root, "#in-day", "15");
  submit(dom, root);
  await tick();
  await tick();

  const result = root.querySelector("#result")!;
  assert(!!result.querySelector(".result-head"), "結果ヘッダがある");
  assert(result.querySelector(".result-head")!.textContent!.includes("3月15日"), "ヘッダに日付");

  // サマリー: 星座（うお座）が決定的に出る
  const facts = [...result.querySelectorAll(".fact .v")].map((e) => e.textContent);
  assert(facts.some((f) => f?.includes("うお座")), `星座うお座が出る（実際: ${facts.join(" / ")}）`);
  assert(facts.some((f) => f?.includes("アクアマリン")), "誕生石アクアマリン");

  // 小ネタセクション（1995-03-15 は水曜・五黄土星。日数系は今日に依存するので値は見ない）
  assert([...result.querySelectorAll("h2")].some((h) => h.textContent!.includes("誕生日の小ネタ")), "小ネタセクション");
  assert(facts.some((f) => f?.includes("水曜日")), `1995-03-15 は水曜（実際: ${facts.join(" / ")}）`);
  assert(facts.some((f) => f?.includes("五黄土星")), "九星 五黄土星");
  assert(
    [...result.querySelectorAll(".fact .k")].some((k) => k.textContent === "生まれてから"),
    "生きた日数のセルがある",
  );

  // 生まれた年（1995・3/15 → 3/13 付の週の1位）
  assert([...result.querySelectorAll("h2")].some((h) => h.textContent!.includes("生まれた年（1995年）")), "生まれた年セクション");
  assert(result.querySelector(".song-title")!.textContent!.includes("ロビンソン"), "生まれた週のオリコン1位");
  assert(result.querySelector(".song-meta")!.textContent!.includes("スピッツ"), "アーティスト名");
  const yearTexts = [...result.querySelectorAll(".year-events li")].map((e) => e.textContent);
  assert(yearTexts.some((t) => t?.includes("誕生日ぴったりのできごと")), "誕生日ぴったりのできごと");
  assert(yearTexts.some((t) => t?.includes("阪神淡路大震災")), "その年の主な出来事");

  // 有名人カード
  const pcards = result.querySelectorAll(".pcard");
  assert(pcards.length === 2, `有名人カード2件（実際: ${pcards.length}）`);
  assert(!!result.querySelector('.pcard[href*="wikipedia"]'), "Wikipedia リンク付きカード");
  assert(!!result.querySelector(".pcard .photo"), "写真ありカードの img");
  // 写真なし(2人目)はイニシャル data-initials を持つ
  const thumbs = [...result.querySelectorAll(".thumb")];
  assert(thumbs.some((t) => (t as HTMLElement).dataset.initials === "SP"), "イニシャルSP（Some Person）");

  // キャラ・記念日
  assert(result.querySelector(".chip .cname")!.textContent === "テストキャラ", "キャラチップ");
  assert([...result.querySelectorAll(".anniv")].some((a) => a.textContent === "靴の記念日"), "記念日チップ");
  assert(result.querySelector(".events .yr")!.textContent === "2013年", "できごと年");

  // 共有ボタン
  assert(!!result.querySelector('[data-action="share-x"]'), "Xシェアボタン");
  assert(!!result.querySelector('[data-action="copy-link"]'), "コピーボタン");

  // URL 同期
  assert(dom.window.location.search === "?d=1995-03-15", `URLに ?d= が入る（実際: ${dom.window.location.search}）`);
  console.log("[dom] 通常フロー OK");

  // ---- 2) 不正日付 → エラー表示 ----
  setSelect(root, "#in-month", "2");
  setSelect(root, "#in-day", "30");
  submit(dom, root);
  await tick();
  assert(!!root.querySelector("#result .error-msg"), "2/30 はエラーメッセージ");
  console.log("[dom] 不正日付ガード OK");
}

// ---- 3) 共有URL（?d=）からの自動復元 ----
{
  const dom = setupDom("https://example.com/samesaengil/?d=2003-12-24");
  const { boot } = await import("../src/app/main");
  const root = dom.window.document.getElementById("app")!;
  boot(root as unknown as HTMLElement);
  await tick();
  await tick();

  assert((root.querySelector("#in-year") as HTMLSelectElement).value === "2003", "URLから年を復元");
  assert((root.querySelector("#in-month") as HTMLSelectElement).value === "12", "URLから月を復元");
  assert((root.querySelector("#in-day") as HTMLSelectElement).value === "24", "URLから日を復元");
  assert(!!root.querySelector("#result .result-head"), "共有URLで自動描画される");
  assert(root.querySelector(".result-head")!.textContent!.includes("12月24日"), "12月24日生まれ");
  console.log("[dom] 共有URL復元 OK");
}

// ---- 4) 「もっと見る」の遅延描画（35人 → 初期30枚 → クリックで35枚） ----
{
  const many: DayData = {
    ...SAMPLE,
    people: Array.from({ length: 35 }, (_, i) => ({
      name: `人物${i}`,
      nameEn: `Person ${i}`,
      year: i === 0 ? 0 : 1990, // i===0 で「生年非公表」表示も確認
      desc: "テスト",
      photo: "",
      url: "",
      jaKnown: false,
      fame: 100 - i,
    })),
    animals: [
      { name: "テスト馬", nameEn: "", year: 2000, desc: "競走馬", photo: "", url: "", jaKnown: true, fame: 5 },
    ],
  };
  const dom = setupDom("https://example.com/samesaengil/");
  // 年データが無い年（範囲外＝404）でも壊れないことも同時に確認する。
  (globalThis as unknown as Record<string, unknown>).fetch = fakeFetch(many, null);
  const { boot } = await import("../src/app/main");
  const root = dom.window.document.getElementById("app")!;
  boot(root as unknown as HTMLElement);
  setSelect(root, "#in-year", "2000");
  setSelect(root, "#in-month", "3");
  setSelect(root, "#in-day", "15");
  submit(dom, root);
  await tick();
  await tick();

  const result = root.querySelector("#result")!;
  assert(result.querySelectorAll(".people-grid[data-people-grid] .pcard").length === 30, "初期は30枚のみ描画");
  const moreBtn = result.querySelector('[data-action="show-more-people"]') as HTMLElement;
  assert(!!moreBtn, "もっと見るボタンがある");
  assert(moreBtn.textContent!.includes("＋5"), `残り5人表示（実際: ${moreBtn.textContent}）`);
  // 生年非公表（year=0）の表示
  assert([...result.querySelectorAll(".pcard .meta")].some((m) => m.textContent!.includes("生年非公表")), "生年非公表を表示");
  // 動物セクション
  assert(!!result.querySelector("section h2")!, "セクションがある");
  assert([...result.querySelectorAll("h2")].some((h) => h.textContent!.includes("動物・名馬")), "動物セクションがある");
  // 年データ 404 のときは「生まれた年」セクションごと非表示（壊れない）
  assert(![...result.querySelectorAll("h2")].some((h) => h.textContent!.includes("生まれた年")), "年データ無しなら年セクションは出ない");

  moreBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await tick();
  assert(result.querySelectorAll(".people-grid[data-people-grid] .pcard").length === 35, "クリックで35枚に増える");
  assert(!result.querySelector('[data-action="show-more-people"]'), "ボタンは消える");
  console.log("[dom] もっと見る遅延描画 OK");
}

console.log("\n✅ DOM smoke test passed");
