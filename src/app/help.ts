// 暦項目の「？」ボタン → 一覧オーバーレイ（星座12・干支12・誕生石12…）の配線と HTML 組み立て。
// 一覧の単一ソースは almanac.ts の export 表。HTML は開くたびに組み立てる
// （8種ぶんを #result に埋め込むと診断のたびに初期 DOM が無駄に重くなるため）。
// dialog.showModal() は使わない＝jsdom（domtest）で動かすため。器は index.astro の静的マークアップ。
import {
  BIRTH_FLOWERS,
  BIRTHSTONES,
  ETO,
  GENERATIONS,
  KYUSEI,
  LIFE_PATH_LABELS,
  MILESTONES,
  ZODIAC,
  daysLivedOf,
  etoOf,
  generationOf,
  jdnToYmd,
  kyuseiOf,
  lifePathOf,
  nextMilestoneOf,
  ymdToJdn,
  zodiacOf,
  type YMD,
} from "../lib/almanac";
import { comma, esc } from "./render";

export type HelpTopic = "zodiac" | "eto" | "stone" | "flower" | "generation" | "milestone" | "lifepath" | "kyusei";

export const HELP_TITLES: Record<HelpTopic, string> = {
  zodiac: "星座の一覧",
  eto: "干支の一覧",
  stone: "誕生石の一覧（月別）",
  flower: "誕生花の一覧（月別）",
  generation: "世代の一覧",
  milestone: "キリ番記念日の一覧",
  lifepath: "数秘（ライフパス）の一覧",
  kyusei: "九星（本命星）の一覧",
};

interface HelpRow {
  label: string;
  value: string;
  /** 診断中の生年月日に該当する行（ハイライト＋「あなた」バッジ）。 */
  me: boolean;
}

/** 数秘の表示順（Record のキー順に頼らない）。 */
const LIFE_PATH_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22, 33];

function rowsFor(topic: HelpTopic, input: YMD | null, today: YMD): HelpRow[] {
  switch (topic) {
    case "zodiac": {
      const mine = input ? zodiacOf(input).name : "";
      return ZODIAC.map(({ z }) => ({ label: `${z.emoji} ${z.name}`, value: z.range, me: z.name === mine }));
    }
    case "eto": {
      const mine = input ? etoOf(input.year).name : "";
      return ETO.map((e) => ({ label: `${e.emoji} ${e.name}（${e.reading}）`, value: e.animal, me: e.name === mine }));
    }
    case "stone":
      return BIRTHSTONES.map((stone, i) => ({ label: `${i + 1}月`, value: stone, me: input?.month === i + 1 }));
    case "flower":
      return BIRTH_FLOWERS.map((f, i) => ({
        label: `${i + 1}月`,
        value: `${f.flower}（${f.meaning}）`,
        me: input?.month === i + 1,
      }));
    case "generation": {
      const mine = input ? generationOf(input.year) : "";
      const rows: HelpRow[] = GENERATIONS.map((g) => ({
        label: g.name,
        value: g.to != null ? `${g.from}〜${g.to}年生まれ` : `${g.from}年生まれ〜`,
        me: mine !== "" && g.name === mine,
      }));
      // 表の範囲より前（1946年より前）は呼称なし。
      const oldest = GENERATIONS[GENERATIONS.length - 1];
      rows.push({ label: "（呼称なし）", value: `〜${oldest.from - 1}年生まれ`, me: input != null && mine === "" });
      return rows;
    }
    case "milestone": {
      const lived = input ? daysLivedOf(input, today) : -1;
      const next = input ? nextMilestoneOf(input, today) : null;
      return MILESTONES.map((m) => {
        if (!input) return { label: `${comma(m)}日目`, value: "", me: false };
        const d = jdnToYmd(ymdToJdn(input) + m);
        const status = m <= lived ? "済" : `あと${comma(m - lived)}日`;
        return { label: `${comma(m)}日目`, value: `${d.year}/${d.month}/${d.day}・${status}`, me: next?.days === m };
      });
    }
    case "lifepath": {
      const mine = input ? lifePathOf(input).number : 0;
      return LIFE_PATH_ORDER.map((n) => ({
        label: n >= 11 ? `${n}（マスターナンバー）` : String(n),
        value: LIFE_PATH_LABELS[n] ?? "",
        me: n === mine,
      }));
    }
    case "kyusei": {
      const mine = input ? kyuseiOf(input).star : "";
      return KYUSEI.map((k) => ({ label: k.star, value: `五行は「${k.element}」`, me: k.star === mine }));
    }
  }
}

/** 一覧本体の HTML（テスト可能なようにビルダを分離）。 */
export function helpListHtml(topic: HelpTopic, input: YMD | null, today: YMD): string {
  const rows = rowsFor(topic, input, today)
    .map(
      (r) =>
        `<li class="help-row${r.me ? " is-me" : ""}"><span class="hl">${esc(r.label)}</span><span class="hv">${esc(
          r.value,
        )}</span>${r.me ? `<span class="me-badge">あなた</span>` : ""}</li>`,
    )
    .join("");
  return `<ol class="help-list">${rows}</ol>`;
}

/**
 * ？ボタン（data-action="almanac-help"）と閉じる操作（close-help・Escape）の配線。
 * root に click 委譲を 1 つだけ張る（more.ts と同じ流儀）。
 */
export function wireHelp(root: HTMLElement, src: { input: () => YMD | null; today: () => YMD }): void {
  const overlay = root.querySelector<HTMLElement>("[data-help-overlay]");
  if (!overlay) return; // 器が無いページ（テストの最小 DOM 等）では何もしない
  const title = overlay.querySelector<HTMLElement>("#help-title");
  const body = overlay.querySelector<HTMLElement>(".help-body");
  if (!title || !body) return;
  // 閉じたとき focus を戻す先（開いたときの ？ ボタン）。
  let opener: HTMLElement | null = null;

  function close(): void {
    overlay!.setAttribute("hidden", "");
    opener?.focus?.();
    opener = null;
  }

  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "almanac-help") {
      const topic = target.dataset.topic as HelpTopic | undefined;
      if (!topic || !(topic in HELP_TITLES)) return;
      title.textContent = HELP_TITLES[topic];
      body.innerHTML = helpListHtml(topic, src.input(), src.today());
      opener = target;
      overlay.removeAttribute("hidden");
      overlay.querySelector<HTMLElement>(".help-close")?.focus?.();
    } else if (action === "close-help") {
      close();
    }
  });
  root.ownerDocument.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !overlay.hasAttribute("hidden")) close();
  });
}
