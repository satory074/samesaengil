// クライアント側のブート・状態・イベント配線。
// フロー: 生年月日入力 → 該当日の JSON を fetch → 暦を計算 → セクション描画 → ?d= 同期。
import type { DayData } from "../lib/types";
import type { YMD } from "../lib/almanac";
import { siteLink } from "../lib/url";
import { dayKey, decodeQuery, encodeQuery, isValidDate, daysInMonth } from "./share";
import { errorHtml, loadingHtml, resultHtml } from "./render";

interface Refs {
  year: HTMLSelectElement;
  month: HTMLSelectElement;
  day: HTMLSelectElement;
  result: HTMLElement;
  form: HTMLFormElement;
}

export function boot(root: HTMLElement): void {
  const refs: Refs = {
    year: root.querySelector("#in-year")!,
    month: root.querySelector("#in-month")!,
    day: root.querySelector("#in-day")!,
    result: root.querySelector("#result")!,
    form: root.querySelector("#bday-form")!,
  };
  if (!refs.form || !refs.result) return;

  // 直近の結果（シェア文言用）。
  let last: { input: YMD; firstPerson?: string } | null = null;

  function readInput(): YMD {
    return {
      year: Number(refs.year.value),
      month: Number(refs.month.value),
      day: Number(refs.day.value),
    };
  }

  function setInput(v: YMD): void {
    refs.year.value = String(v.year);
    refs.month.value = String(v.month);
    syncDayOptions();
    refs.day.value = String(v.day);
  }

  /** 月・年に応じて日の選択肢（末日）を調整。 */
  function syncDayOptions(): void {
    const y = Number(refs.year.value);
    const m = Number(refs.month.value);
    const max = daysInMonth(y || 2000, m || 1);
    for (const opt of Array.from(refs.day.options)) {
      opt.hidden = Number(opt.value) > max;
    }
    if (Number(refs.day.value) > max) refs.day.value = String(max);
  }

  function todayYMD(): YMD {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  async function fetchDay(key: string): Promise<DayData | null> {
    try {
      const res = await fetch(siteLink(`/data/days/${key}.json`), { cache: "force-cache" });
      if (!res.ok) return null;
      return (await res.json()) as DayData;
    } catch {
      return null;
    }
  }

  function syncUrl(input: YMD): void {
    try {
      history.replaceState(null, "", `${location.pathname}${encodeQuery(input)}`);
    } catch {
      /* jsdom 等で history が無い場合は無視 */
    }
  }

  async function diagnose(): Promise<void> {
    const input = readInput();
    if (!isValidDate(input.year, input.month, input.day)) {
      refs.result.innerHTML = errorHtml("その日付は存在しないみたい。月末の日付を確認してね。");
      return;
    }
    syncUrl(input);
    refs.result.innerHTML = loadingHtml();
    const key = dayKey(input.month, input.day);
    const day = (await fetchDay(key)) ?? emptyDay(key);
    refs.result.innerHTML = resultHtml(input, todayYMD(), day);
    last = { input, firstPerson: day.people[0]?.name };
  }

  function shareText(): string {
    const i = last?.input;
    const head = i ? `【${i.month}月${i.day}日生まれ】` : "";
    const who = last?.firstPerson ? `同じ誕生日の有名人は${last.firstPerson}など！` : "";
    return `${head}${who}あなたは誰と一緒？ #samesaengil`;
  }

  // ---- イベント配線 ----
  refs.form.addEventListener("submit", (e) => {
    e.preventDefault();
    void diagnose();
  });
  refs.month.addEventListener("change", syncDayOptions);
  refs.year.addEventListener("change", syncDayOptions);

  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "share-x") {
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText())}&url=${encodeURIComponent(
        location.href,
      )}`;
      window.open(url, "_blank", "noopener");
    } else if (action === "copy-link") {
      void copyLink(target);
    }
  });

  async function copyLink(btn: HTMLElement): Promise<void> {
    try {
      await navigator.clipboard?.writeText(location.href);
      btn.classList.add("copied");
      const orig = btn.textContent;
      btn.textContent = "✓ コピーしました";
      setTimeout(() => {
        btn.classList.remove("copied");
        if (orig) btn.textContent = orig;
      }, 1600);
    } catch {
      /* clipboard 不可環境は無視 */
    }
  }

  // ---- 初期化 ----
  syncDayOptions();
  const shared = decodeQuery(location.search);
  if (shared) {
    setInput(shared);
    void diagnose();
  }
}

function emptyDay(key: string): DayData {
  return { date: key, people: [], characters: [], anniversaries: [], events: [], updatedAt: "" };
}
