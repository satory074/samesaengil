// 「推し」セクション用の再カット（純関数・DOM 非依存）。
//
// 新しいソースは足さない: VTuber は既に characters（fanweb バルク）に、K-POP アイドルは
// 既に people（日本語版Wikipedia の誕生日節）に入っている。ただし 1 日最大 1932 件の
// キャラ一覧・200人超の有名人一覧に埋もれているので、ここで拾い直して専用セクションに出す。
// 元の一覧からは**除外しない**（推しは「ハイライト」であって、全件は元のセクションで見られる）。
import type { Character, Person } from "./types";

/* ---------- VTuber ---------- */

/** fanweb の作品名。表記ゆれ（Youtuber / YouTuber）がそのまま入っているので両方持つ。 */
export const VTUBER_WORKS = [
  "にじさんじ",
  "ホロライブプロダクション",
  "ぶいすぽっ！",
  "バーチャルYouTuber",
  "バーチャルYoutuber",
];

export function isVtuber(c: Character): boolean {
  return VTUBER_WORKS.includes(c.work);
}

export function vtubersOf(chars: Character[]): Character[] {
  return chars.filter(isVtuber);
}

/* ---------- K-POP ---------- */

/**
 * 肩書き（desc）に出るグループ名で判定する。例:
 *   "アイドル、歌手（BTS）" / "アイドル（IVE、元IZ*ONE）" / "アイドル（(G)I-DLE）"
 * 曖昧な語（Nature 等）は誤検出が多いので入れない。
 */
export const KPOP_GROUPS = [
  "BTS", "TWICE", "BLACKPINK", "IVE", "NewJeans", "SEVENTEEN", "Stray Kids", "ITZY", "aespa",
  "LE SSERAFIM", "ENHYPEN", "TOMORROW X TOGETHER", "TXT", "NCT", "WayV", "EXO", "SHINee",
  "Red Velvet", "(G)I-DLE", "IZ*ONE", "少女時代", "BIGBANG", "2NE1", "MONSTA X", "ATEEZ",
  "TREASURE", "ZEROBASEONE", "RIIZE", "ILLIT", "BABYMONSTER", "KARA", "T-ARA", "Wanna One",
  "GOT7", "TVXQ", "東方神起", "JYJ", "SUPER JUNIOR", "BOYNEXTDOOR", "fromis_9", "STAYC",
  "Kep1er", "NMIXX", "OH MY GIRL", "MAMAMOO", "Apink", "GFRIEND", "EVERGLOW", "VIVIZ",
  "PENTAGON", "THE BOYZ", "NiziU", "IU", "CNBLUE", "FTISLAND", "WINNER", "iKON", "EXID",
  "AOA", "DREAMCATCHER", "LOONA", "宇宙少女", "CLC", "Rocket Punch", "Billlie", "tripleS",
  "QWER", "KATSEYE", "XG", "&TEAM", "BOYS PLANET",
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ラテン文字のグループ名は前後を英数字で挟まれていないことを要求する。
 * これが無いと "Aivery" が "IVE" に、"KARAOKE" が "KARA" に部分一致して誤検出する。
 */
const KPOP_RE = new RegExp(
  KPOP_GROUPS.map((g) => (/^[\x20-\x7e]+$/.test(g) ? `(?<![A-Za-z0-9])${esc(g)}(?![A-Za-z0-9])` : esc(g)))
    .concat(["K-POP", "韓国のアイドル", "韓国の歌手"])
    .join("|"),
);

export function isKpop(p: Person): boolean {
  return KPOP_RE.test(p.desc);
}

export function kpopOf(people: Person[]): Person[] {
  return people.filter(isKpop);
}
