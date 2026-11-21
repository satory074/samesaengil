// 「もっと見る」の遅延描画（有名人・キャラは1日に数百〜千件あるので初期 DOM を軽く保つ）。
// トップの結果画面（main.ts）と日別ページ（day.ts）で共用＝実装を二重に持たない。
import type { Character, Game, NicoVideo, Person, YearPerson } from "../lib/types";
import { charactersMoreHtml, gamesMoreHtml, nicoMoreHtml, peopleMoreHtml, yearPeopleMoreHtml } from "./render";

/**
 * 全件の取得元（クリック時に評価する）。トップは描画済みの配列を同期で返す。
 * 日別ページは押されて初めて per-day JSON を取りに行くので Promise も許す
 * （検索から来た人に数百KB の JSON を必ず読ませない）。
 */
type Source<T> = () => T[] | Promise<T[]>;

export interface MoreSource {
  people: Source<Person>;
  characters: Source<Character>;
  /** 同い年の有名人（⭐ 完全一致に出した人を除いたもの＝描画に使ったのと同じ配列）。 */
  yearPeople: Source<YearPerson>;
  /** 発売ゲーム（⭐ 生まれた日ちょうどに出したものを除いたもの＝描画に使ったのと同じ配列）。 */
  games: Source<Game>;
  /** ミリオン動画（⭐ 生まれた日ちょうどに出したものを除いたもの＝描画に使ったのと同じ配列）。 */
  nico: Source<NicoVideo>;
}

/** root に click 委譲を 1 つだけ張る。ビルド時に書き出した「もっと見る」ボタンにもそのまま効く。 */
export function wireMoreButtons(root: HTMLElement, src: MoreSource): void {
  root.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const section = target.closest(".section");

    let run: (() => Promise<boolean>) | null = null;
    if (action === "show-more-people") {
      run = () => append(section?.querySelector("[data-people-grid]"), src.people, peopleMoreHtml);
    } else if (action === "show-more-chars") {
      run = () => append(section?.querySelector("[data-char-list]"), src.characters, charactersMoreHtml);
    } else if (action === "show-more-games") {
      run = () => append(section?.querySelector("[data-games-list]"), src.games, gamesMoreHtml);
    } else if (action === "show-more-nico") {
      run = () => append(section?.querySelector("[data-nico-list]"), src.nico, nicoMoreHtml);
    } else if (action === "show-more-year-people") {
      // 同い年セクションはカテゴリごとにグリッドが分かれているので data-cat で対応づける。
      const cat = target.dataset.cat ?? "";
      run = () =>
        append(section?.querySelector(`[data-year-grid="${cat}"]`), src.yearPeople, (p) => yearPeopleMoreHtml(p, cat));
    }
    if (!run) return;

    // 取得中の二重クリック防止。instanceof HTMLButtonElement は使わない
    // （jsdom 環境ではそのクラスがグローバルに無く ReferenceError になる）。
    const btn = target as Partial<HTMLButtonElement>;
    if (btn.disabled) return;
    btn.disabled = true;
    void run().then((done) => {
      // 取得に失敗した（空で返った）ときはボタンを残し、もう一度押せるようにする。
      if (done) target.remove();
      else btn.disabled = false;
    });
  });
}

/** 全件の配列を受け、描画用ビルダ（先頭の初期表示ぶんを除いた残りを返す）で追記する。 */
async function append<T>(
  container: Element | null | undefined,
  source: Source<T>,
  moreHtml: (all: T[]) => string,
): Promise<boolean> {
  const all = await source();
  if (!container || all.length === 0) return false;
  container.insertAdjacentHTML("beforeend", moreHtml(all));
  return true;
}
