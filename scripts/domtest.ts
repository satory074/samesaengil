// DOM スモークテスト: boot → 入力 → fetch(スタブ) → セクション描画 → ?d= 同期 → 共有URL復元。
// 実行: npx tsx scripts/domtest.ts
import { JSDOM } from "jsdom";
import type { DayData } from "../src/lib/types";

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
  characters: [{ name: "テストキャラ", work: "TEST", color: "#ff0000" }],
  anniversaries: [{ label: "靴の記念日", desc: "日本記念日協会" }, { label: "サイコの日" }],
  events: [{ year: 2013, text: "新幹線200系電車引退。" }],
  updatedAt: "2026-06-30T00:00:00Z",
};

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
  // fetch をスタブ（どの URL でも SAMPLE を返す）
  g.fetch = async () => ({ ok: true, json: async () => SAMPLE }) as unknown as Response;
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

  // 有名人カード
  const pcards = result.querySelectorAll(".pcard");
  assert(pcards.length === 2, `有名人カード2件（実際: ${pcards.length}）`);
  assert(!!result.querySelector('.pcard[href*="wikipedia"]'), "Wikipedia リンク付きカード");
  assert(!!result.querySelector(".pcard .photo"), "写真ありカードの img");
  assert(!!result.querySelector(".ja-flag"), "「日本でも有名」バッジ");
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

console.log("\n✅ DOM smoke test passed");
