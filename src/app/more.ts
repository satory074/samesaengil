// 「もっと見る」の遅延描画（有名人・キャラは1日に数百〜千件あるので初期 DOM を軽く保つ）。
import type { Character, Person, YearPerson } from "../lib/types";
import { charactersMoreHtml, peopleMoreHtml, yearPeopleMoreHtml } from "./render";

/** 全件の取得元（クリック時に評価する＝描画済みの配列を返す）。 */
export interface MoreSource {
  people: () => Person[];
  characters: () => Character[];
  /** 同い年の有名人（⭐ 完全一致に出した人を除いたもの＝描画に使ったのと同じ配列）。 */
  yearPeople: () => YearPerson[];
}

/** root に click 委譲を 1 つだけ張る。 */
export function wireMoreButtons(root: HTMLElement, src: MoreSource): void {
  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    const section = target.closest(".section");
    if (action === "show-more-people") {
      const grid = section?.querySelector("[data-people-grid]");
      const people = src.people();
      if (grid && people.length) grid.insertAdjacentHTML("beforeend", peopleMoreHtml(people));
    } else if (action === "show-more-chars") {
      const list = section?.querySelector("[data-char-list]");
      const chars = src.characters();
      if (list && chars.length) list.insertAdjacentHTML("beforeend", charactersMoreHtml(chars));
    } else if (action === "show-more-year-people") {
      // 同い年セクションはカテゴリごとにグリッドが分かれているので data-cat で対応づける。
      const cat = target.dataset.cat ?? "";
      const grid = section?.querySelector(`[data-year-grid="${cat}"]`);
      const people = src.yearPeople();
      if (grid && people.length) grid.insertAdjacentHTML("beforeend", yearPeopleMoreHtml(people, cat));
    } else {
      return;
    }
    target.remove();
  });
}
