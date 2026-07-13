// 日別ページ（/day/MM-DD）のクライアント。
// 本文（有名人30件・キャラ40件・記念日）は Astro が SSG 済みなので、ここでやるのは 2 つだけ:
//   1) 「もっと見る」が押されたときだけ per-day JSON を取り、残りを描く（初回ロードでは読まない）
//   2) 年を入れたらトップ（?d=YYYY-MM-DD）へ送る導線
import type { Character, DayData, Person } from "../lib/types";
import { siteLink } from "../lib/url";
import { wireMoreButtons } from "./more";

export function bootDay(root: HTMLElement, key: string): void {
  // 1 回だけ取得してメモ化（有名人・キャラの両方のボタンで共有）。
  let dayPromise: Promise<Partial<DayData>> | null = null;
  const loadDay = (): Promise<Partial<DayData>> => {
    dayPromise ??= fetch(siteLink(`/data/days/${key}.json`), { cache: "no-cache" })
      .then((res) => (res.ok ? (res.json() as Promise<Partial<DayData>>) : {}))
      .catch(() => ({}) as Partial<DayData>);
    return dayPromise;
  };

  wireMoreButtons(root, {
    people: async (): Promise<Person[]> => (await loadDay()).people ?? [],
    characters: async (): Promise<Character[]> => (await loadDay()).characters ?? [],
  });

  const form = root.querySelector<HTMLFormElement>("#year-form");
  const year = root.querySelector<HTMLSelectElement>("#in-year");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!year) return;
    location.href = siteLink(`/?d=${year.value}-${key}`);
  });
}
