// 日別ページ（/day/MM-DD/）のクライアント。
// 本文（有名人30件・キャラ40件・記念日・ゲーム30本・動画30本）は Astro がビルド時に書き出し済みなので、
// ここでやるのは 2 つだけ（JS が無くても本文は読める＝検索エンジン・AI クローラー向け）:
//   1) 「もっと見る」が押されたときだけ per-day JSON を取り、残りを描く（初回ロードでは読まない）
//   2) 生まれた年を選んだらトップ（?d=YYYY-MM-DD）へ送る
import type { DayData } from "../lib/types";
import { siteLink } from "../lib/url";
import { wireMoreButtons } from "./more";
import { dayPageLists } from "./render";

type Lists = ReturnType<typeof dayPageLists>;

export function bootDay(root: HTMLElement, key: string): void {
  // 1 回だけ取得してメモ化（4 つのボタンで共有）。失敗したら覚えず、次の押下で取り直す。
  let pending: Promise<Lists | null> | null = null;
  const load = (): Promise<Lists | null> => {
    pending ??= fetch(siteLink(`/data/days/${key}.json`), { cache: "no-cache" })
      .then((res) => (res.ok ? (res.json() as Promise<Partial<DayData>>) : null))
      .catch(() => null)
      .then((d) => {
        if (!d) {
          pending = null;
          return null;
        }
        // ページを描いたのと同じ切り方（render.ts の dayPageLists）を通す。
        return dayPageLists({
          people: d.people ?? [],
          animals: d.animals ?? [],
          characters: d.characters ?? [],
          games: d.games ?? [],
          nicovideos: d.nicovideos ?? [],
        });
      });
    return pending;
  };

  wireMoreButtons(root, {
    people: async () => (await load())?.people ?? [],
    characters: async () => (await load())?.characters ?? [],
    games: async () => (await load())?.games ?? [],
    nico: async () => (await load())?.nico ?? [],
    yearPeople: () => [], // 日別ページに「同じ学年」は無い（年に依存する）
  });

  const form = root.querySelector<HTMLFormElement>("#year-form");
  const year = root.querySelector<HTMLSelectElement>("#in-year");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!year) return;
    location.href = siteLink(`/?d=${year.value}-${key}`);
  });
}
