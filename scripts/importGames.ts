// 発売されたゲームソフトの取込。成果物 src/data/games.json はコミットする
// （aggregate は実行時に第三者サイトへ依存しない。importKinenbi.ts と同じ流儀）。
//
//   npm run import:games                    … 全機種＋Steam を取得して上書き
//   npx tsx scripts/importGames.ts ファミコン PS2   … 指定機種だけ（デバッグ。ファイルは書かない）
//   GAMES_SKIP_STEAM=1 npm run import:games … Wikipedia の機種別一覧だけ
//   STEAM_MAX_REQUESTS=1200 npm run import:games … Steam の 1 実行あたり送信上限（既定 600）
//
// 出力は「1 プラットフォーム 1 行」の素の配列。同日同名の複数機種同時発売をまとめるのは
// aggregate 側（buildGameMap）で、人気順の並べ替えと一緒に行う。
import fs from "node:fs";
import path from "node:path";
import { PLATFORMS, articlesOf, fetchGameCategory, filterPcGames } from "./sources/gameSources";
import { fetchGameList } from "./sources/jawikiGameList";
import { emptySteamStats, resolveSteam, type SteamCache } from "./sources/steamStore";
import { mapLimit } from "./lib/util";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "src", "data", "games.json");
const STEAM_PATH = path.join(ROOT, "src", "data", "steam.json");

/** games.json の 1 行（1 機種 1 行。同日同名の複数機種は aggregate 側でまとめる）。 */
export interface GameSeed {
  name: string;
  /** jawiki 記事タイトル（人気の解決とリンクに使う）。 */
  title?: string;
  year: number;
  month: number;
  day: number;
  platform: string;
  /** Steam の appid（platform === "Steam" のみ）。 */
  appid?: number;
}

const STEAM_LABEL = "Steam";
/** Steam 候補を採る年の範囲（Steam のサービス開始は 2003年）。 */
const STEAM_FROM = 2003;

/** 発売予定（未来日）は載せない。一覧記事には翌年以降の予定表も含まれるため。 */
function isReleased(g: { year: number; month: number; day: number }, today: Date): boolean {
  const t = new Date(Date.UTC(g.year, g.month - 1, g.day));
  return t.getTime() <= today.getTime();
}

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 指定があればその機種だけ（デバッグ実行＝ファイル未書込）。 */
function selectPlatforms(): { list: typeof PLATFORMS; debug: boolean } {
  const args = [...process.argv.slice(2), ...(process.env.ONLY_PLATFORMS ?? "").split(/[,\s]+/)].filter(Boolean);
  if (!args.length) return { list: PLATFORMS, debug: false };
  const list = PLATFORMS.filter((p) => args.some((a) => p.label.includes(a) || p.article.includes(a)));
  return { list: list.length ? list : PLATFORMS, debug: true };
}

/** 前回の games.json を機種ごとに索引（取得 0 件の機種を空で上書きしないため）。 */
function readPrevByPlatform(): Map<string, GameSeed[]> {
  const prev = readJson<GameSeed[]>(OUT_PATH, []);
  const map = new Map<string, GameSeed[]>();
  for (const row of prev) {
    const bucket = map.get(row.platform);
    if (bucket) bucket.push(row);
    else map.set(row.platform, [row]);
  }
  return map;
}

/** 1 オブジェクト 1 行（git diff を読める状態に保つ）。 */
function serialize(rows: GameSeed[]): string {
  return `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
}

/** 機種別一覧（日本語版Wikipedia）。 */
async function collectFromWikipedia(
  platforms: typeof PLATFORMS,
  prev: Map<string, GameSeed[]>,
  today: Date,
): Promise<{ rows: GameSeed[]; empties: string[]; kept: string[] }> {
  const rows: GameSeed[] = [];
  const empties: string[] = [];
  const kept: string[] = [];

  for (const platform of platforms) {
    const articles = await articlesOf(platform);
    const perArticle = await mapLimit(articles, 2, async (article) => {
      const list = await fetchGameList(article);
      if (!list.length) empties.push(article);
      return list;
    });
    const got = perArticle.flat().filter((g) => isReleased(g, today)).map<GameSeed>((g) => ({
      name: g.name,
      ...(g.title ? { title: g.title } : {}),
      year: g.year,
      month: g.month,
      day: g.day,
      platform: platform.label,
    }));
    const before = prev.get(platform.label) ?? [];
    if (!got.length && before.length) {
      kept.push(platform.label);
      rows.push(...before);
      continue;
    }
    // 表の構造が変わるとパースが静かに痩せる。前回より大きく減ったら気付けるようにする。
    const drop = before.length ? Math.round((1 - got.length / before.length) * 100) : 0;
    const note = drop >= 20 ? `  ⚠ 前回より${drop}%減（${before.length}本→）` : "";
    console.log(`  ${platform.label}: ${got.length}本（記事${articles.length}本）${note}`);
    rows.push(...got);
  }
  return { rows, empties, kept };
}

/**
 * Steam（PC）。jawiki の年別カテゴリから候補を採り、機種別一覧で拾えた名前を除いてから
 * 公式ストアに問い合わせる。上限に達したぶんは次回実行に持ち越す。
 */
async function collectFromSteam(
  covered: Set<string>,
  prev: Map<string, GameSeed[]>,
  thisYear: number,
): Promise<GameSeed[]> {
  const cache = readJson<SteamCache>(STEAM_PATH, {});
  const stats = emptySteamStats();

  const years = Array.from({ length: thisYear - STEAM_FROM + 1 }, (_, i) => STEAM_FROM + i);
  const articles: string[] = [];
  const seen = new Set<string>();
  for (const year of years) {
    for (const title of await fetchGameCategory(year)) {
      if (seen.has(title) || covered.has(title)) continue;
      seen.add(title);
      articles.push(title);
    }
  }
  // 家庭用機だけの作品を Steam に総当たりすると埋まるまでに何十週もかかるので、先にカテゴリで絞る。
  const pcArticles = await filterPcGames(articles);
  // 検索語（曖昧さ回避の括弧を落としたもの）→ 元の jawiki 記事タイトル。
  const candidates = new Map<string, string>();
  for (const title of pcArticles) {
    // 「〜 (ゲーム)」「〜 (2022年のゲーム)」の括弧はストア検索の邪魔なので落とす。
    const term = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (!term || covered.has(term) || candidates.has(term)) continue;
    candidates.set(term, title);
  }
  console.log(
    `[games] Steam 候補 ${candidates.size}件（年別カテゴリ ${articles.length}件 → PC のもの ${pcArticles.length}件。キャッシュ済みを含む）…`,
  );

  await resolveSteam([...candidates.keys()], cache, stats);
  fs.writeFileSync(STEAM_PATH, `${JSON.stringify(cache, null, 0)}\n`);
  console.log(
    `[games] Steam: 新規解決${stats.resolved} / 未収録${stats.missing} / キャッシュ${stats.cached}` +
      ` / 失敗${stats.failed} / 上限持ち越し${stats.skipped}`,
  );

  const rows: GameSeed[] = [];
  for (const [term, article] of candidates) {
    const hit = cache[term];
    if (!hit?.appid || !hit.date) continue;
    const [y, m, d] = hit.date.split("-").map(Number);
    if (!y || !m || !d) continue;
    rows.push({
      name: hit.name || term,
      title: article,
      year: y,
      month: m,
      day: d,
      platform: STEAM_LABEL,
      appid: hit.appid,
    });
  }
  // 週次 CI で空上書きしない（importKinenbi.ts と同じ規範）。
  if (!rows.length) {
    const before = prev.get(STEAM_LABEL) ?? [];
    if (before.length) {
      console.warn("[games] Steam が 0 件だったので前回値を維持します");
      return before;
    }
  }
  return rows;
}

async function run(): Promise<void> {
  const { list, debug } = selectPlatforms();
  const prev = readPrevByPlatform();
  const today = new Date();
  console.log(`[games] ${list.length}機種ぶんを取得します${debug ? "（デバッグ実行: ファイルは書きません）" : ""}…`);

  const { rows, empties, kept } = await collectFromWikipedia(list, prev, today);

  // Steam 候補から除く名前（機種別一覧に既にあるもの）。
  const covered = new Set(rows.flatMap((r) => [r.name, r.title ?? ""]).filter(Boolean));

  let steamRows: GameSeed[] = [];
  if (!debug && !process.env.GAMES_SKIP_STEAM) {
    steamRows = await collectFromSteam(covered, prev, new Date().getFullYear());
  } else if (!debug) {
    steamRows = prev.get(STEAM_LABEL) ?? [];
  }

  const all = [...rows, ...steamRows];
  all.sort((a, b) => a.month - b.month || a.day - b.day || b.year - a.year || a.name.localeCompare(b.name, "ja"));

  console.log(`[games] 合計 ${all.length}本（Wikipedia ${rows.length} / Steam ${steamRows.length}）`);
  if (kept.length) console.warn(`[games] ⚠ 0件だったので前回値を維持した機種: ${kept.join(", ")}`);
  // 親記事が「発売されなかったソフト」しか持たない機種（PS・DS）は常にここに出る＝正常。
  // 機種の合計が減っていないかを上の「前回より○%減」と合わせて見る。
  if (empties.length) console.log(`[games] 一覧表の無かった記事: ${empties.join(" / ")}`);

  if (debug) {
    for (const r of all.slice(0, 20)) console.log(`  ${r.year}-${r.month}-${r.day} ${r.name} [${r.platform}]`);
    return;
  }
  fs.writeFileSync(OUT_PATH, serialize(all));
  console.log(`[games] ${OUT_PATH} を書き出しました`);
}

run().catch((e) => {
  console.error("[games] 致命的エラー:", e);
  process.exit(1);
});
