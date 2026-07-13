// 「もっと見る」の遅延描画（有名人・キャラは1日に数百〜千件あるので初期 DOM を軽く保つ）。
import type { Character, Person } from "../lib/types";
import { charactersMoreHtml, peopleMoreHtml } from "./render";

/** 全件の取得元（クリック時に評価する＝描画済みの配列を返す）。 */
export interface MoreSource {
  people: () => Person[];
  characters: () => Character[];
}

/** root に click 委譲を 1 つだけ張る。 */
export function wireMoreButtons(root: HTMLElement, src: MoreSource): void {
  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action !== "show-more-people" && action !== "show-more-chars") return;

    const section = target.closest(".section");
    if (action === "show-more-people") {
      const grid = section?.querySelector("[data-people-grid]");
      const people = src.people();
      if (grid && people.length) grid.insertAdjacentHTML("beforeend", peopleMoreHtml(people));
    } else {
      const list = section?.querySelector("[data-char-list]");
      const chars = src.characters();
      if (list && chars.length) list.insertAdjacentHTML("beforeend", charactersMoreHtml(chars));
    }
    target.remove();
  });
}
