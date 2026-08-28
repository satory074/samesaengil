// 「〈機種〉のゲームタイトル一覧」記事の一覧（日本語版Wikipedia）。
//
// 記事は機種ごとに 1 本のものと、年別サブ記事に分割されているもの（PS / PS2 / PS4 / PS5 /
// DS / Switch）がある。サブ記事名は年が進むと増えるので **ハードコードせず**、
// list=allpages&apprefix=<親記事> で実行時に列挙する（リダイレクトは除外）。
// ここで持つのは「機種の表示名 → 親記事名」だけ。
import { fetchJson } from "../lib/util";

/** 機種 1 つぶんの定義。 */
export interface GamePlatform {
  /** 表示に使う短い機種名（チップに出る）。 */
  label: string;
  /** 親記事名。年別サブ記事はここから allpages で導出する。 */
  article: string;
}

/**
 * 家庭用機・携帯機。日本国内で発売されたソフトの一覧記事があるものすべて
 * （バーチャルボーイのみ一覧記事が存在しない）。
 */
export const PLATFORMS: GamePlatform[] = [
  { label: "ファミコン", article: "ファミリーコンピュータのゲームタイトル一覧" },
  { label: "スーパーファミコン", article: "スーパーファミコンのゲームタイトル一覧" },
  { label: "ゲームボーイ", article: "ゲームボーイのゲームタイトル一覧" },
  { label: "ゲームボーイカラー", article: "ゲームボーイカラーのゲームタイトル一覧" },
  { label: "ゲームボーイアドバンス", article: "ゲームボーイアドバンスのゲームタイトル一覧" },
  { label: "ニンテンドウ64", article: "NINTENDO 64のゲームタイトル一覧" },
  { label: "ゲームキューブ", article: "ニンテンドー ゲームキューブのゲームタイトル一覧" },
  { label: "ニンテンドーDS", article: "ニンテンドーDSのゲームタイトル一覧" },
  { label: "ニンテンドー3DS", article: "ニンテンドー3DSのゲームタイトル一覧" },
  { label: "Wii", article: "Wiiのゲームタイトル一覧" },
  { label: "Wii U", article: "Wii Uのゲームタイトル一覧" },
  { label: "Switch", article: "Nintendo Switchのゲームタイトル一覧" },
  { label: "Switch 2", article: "Nintendo Switch 2のゲームタイトル一覧" },
  { label: "プレイステーション", article: "PlayStationのゲームタイトル一覧" },
  { label: "PS2", article: "PlayStation 2のゲームタイトル一覧" },
  { label: "PS3", article: "PlayStation 3のゲームタイトル一覧" },
  { label: "PS4", article: "PlayStation 4のゲームタイトル一覧" },
  { label: "PS5", article: "PlayStation 5のゲームタイトル一覧" },
  { label: "PSP", article: "PlayStation Portableのゲームタイトル一覧" },
  { label: "PS Vita", article: "PlayStation Vitaのゲームタイトル一覧" },
  { label: "セガサターン", article: "セガサターンのゲームタイトル一覧" },
  { label: "メガドライブ", article: "メガドライブのゲームタイトル一覧" },
  { label: "ドリームキャスト", article: "ドリームキャストのゲームタイトル一覧" },
  { label: "PCエンジン", article: "PCエンジンのゲームタイトル一覧" },
  { label: "Xbox", article: "Xboxのゲームタイトル一覧" },
  { label: "Xbox 360", article: "Xbox 360のゲームタイトル一覧" },
  { label: "Xbox One", article: "Xbox Oneのゲームタイトル一覧" },
  { label: "Xbox Series X|S", article: "Xbox Series X/Sのゲームタイトル一覧" },
  { label: "ネオジオ", article: "ネオジオのゲームタイトル一覧" },
  { label: "ワンダースワン", article: "ワンダースワンのゲームタイトル一覧" },
  { label: "3DO", article: "3DOのゲームタイトル一覧" },
];

const API = "https://ja.wikipedia.org/w/api.php";

interface AllPagesResponse {
  query?: { allpages?: { title?: string }[] };
}

interface CategoryResponse {
  query?: { categorymembers?: { title?: string }[] };
  continue?: { cmcontinue?: string };
}

/**
 * 「Category:YYYY年のコンピュータゲーム」の記事名（PC ゲームの候補源）。
 * 機種別一覧に載らない Steam / PC 専用作品を拾うための入口で、記事があるくらい
 * 知られている作品だけに絞る役目も兼ねる。失敗時は [] を返す（throw しない）。
 */
export async function fetchGameCategory(year: number): Promise<string[]> {
  const out: string[] = [];
  let cont: string | undefined;
  for (let page = 0; page < 6; page++) {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${year}年のコンピュータゲーム`,
      cmnamespace: "0",
      cmlimit: "500",
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    if (cont) params.set("cmcontinue", cont);
    try {
      const data = await fetchJson<CategoryResponse>(`${API}?${params.toString()}`);
      for (const m of data.query?.categorymembers ?? []) if (m.title) out.push(m.title);
      cont = data.continue?.cmcontinue;
    } catch {
      return out;
    }
    if (!cont) break;
  }
  return out;
}

interface CategoriesResponse {
  query?: { pages?: { title?: string; categories?: { title?: string }[] }[] };
}

/** PC で出たことを示すカテゴリ。Steam に問い合わせる価値がある記事の見分けに使う。 */
const PC_CATEGORIES = [
  "Category:Windows用ゲームソフト",
  "Category:MacOS用ゲームソフト",
  "Category:Linux用ゲームソフト",
];

/**
 * 候補記事のうち「PC でも出ている」ものだけに絞る（50件バッチ・1リクエストで判定）。
 * Steam ストアは 5分あたり 200 リクエスト程度で 429 になるため、家庭用機だけの作品を
 * 総当たりすると埋まるまでに何十週もかかる。カテゴリで先に半分以下に落とす。
 *
 * `clcategories` で**見たいカテゴリだけ**を返させる——`cllimit=max` でも 1 リクエストの
 * カテゴリ総数には上限があり、50 記事ぶんの全カテゴリを取ると後ろの記事が切り捨てられる。
 * 失敗時は「絞らない」（＝そのバッチは全件通す）で安全側に倒す。
 */
export async function filterPcGames(titles: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "query",
      prop: "categories",
      cllimit: "max",
      clcategories: PC_CATEGORIES.join("|"),
      titles: batch.join("|"),
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    try {
      const data = await fetchJson<CategoriesResponse>(`${API}?${params.toString()}`);
      for (const page of data.query?.pages ?? []) {
        if (page.title && (page.categories ?? []).length > 0) out.push(page.title);
      }
    } catch {
      out.push(...batch);
    }
  }
  return out;
}

/**
 * 親記事とその年別サブ記事（実記事のみ、リダイレクトは除く）を列挙する。
 * 失敗時は親記事だけを返す（throw しない）。
 */
export async function articlesOf(platform: GamePlatform): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "allpages",
    apprefix: platform.article,
    apnamespace: "0",
    apfilterredir: "nonredirects",
    aplimit: "60",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  try {
    const data = await fetchJson<AllPagesResponse>(`${API}?${params.toString()}`);
    const titles = (data.query?.allpages ?? []).map((p) => p.title ?? "").filter(Boolean);
    return titles.length ? titles : [platform.article];
  } catch {
    return [platform.article];
  }
}
