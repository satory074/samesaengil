// 「もっと見る」の遅延描画（トップ / 日別ページで共用＝実装を二重に持たない）。
import type { Character, Person } from "../lib/types";
import { charactersMoreHtml, peopleMoreHtml } from "./render";

/**
 * 全件の取得元（クリック時に評価する）。
 * 日別ページは「もっと見る」が押されて初めて per-day JSON を取りに行くので Promise も許す
 * （SEO ランディングで数百KB を必ず読ませない）。トップは描画済みの配列を同期で返す。
 */
export interface MoreSource {
  people: () => Person[] | Promise<Person[]>;
  characters: () => Character[] | Promise<Character[]>;
}

/** root に click 委譲を 1 つだけ張る。SSG された「もっと見る」ボタンにもそのまま効く。 */
export function wireMoreButtons(root: HTMLElement, src: MoreSource): void {
  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action !== "show-more-people" && action !== "show-more-chars") return;

    const section = target.closest(".section");
    // 取得中の二重クリック防止。instanceof HTMLButtonElement は使わない
    // （jsdom 環境ではそのクラスがグローバルに無く ReferenceError になる）。
    (target as Partial<HTMLButtonElement>).disabled = true;
    void (async () => {
      if (action === "show-more-people") {
        const grid = section?.querySelector("[data-people-grid]");
        const people = await src.people();
        if (grid && people.length) grid.insertAdjacentHTML("beforeend", peopleMoreHtml(people));
      } else {
        const list = section?.querySelector("[data-char-list]");
        const chars = await src.characters();
        if (list && chars.length) list.insertAdjacentHTML("beforeend", charactersMoreHtml(chars));
      }
      target.remove();
    })();
  });
}
