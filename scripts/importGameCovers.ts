// ゲームのジャケット画像（IGDB の cover image_id）を src/data/igdb.json に貯める取込スクリプト。
// 成果物はコミットする（aggregate は実行時に第三者サイトへ依存しない）。
//
//   npm run import:covers                … Wikidata 橋渡しで一括解決（数分）＋ ラテン文字名の保険
//   IGDB_SEARCH_MAX=0 npm run import:covers … 保険（1件ずつの search）を止めて Wikidata 段だけ
//   IGDB_RECHECK=1 npm run import:covers … 「見つからなかった」負キャッシュも引き直す
//   GAMES_ONLY=1 npm run aggregate       … 全366日へ反映（数秒）
//
// キー（IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）が無ければ何もせず終わる＝表示側は Steam 由来の
// ジャケか 🎮 プレースホルダのまま（Spotify と同じ graceful degradation）。
//
// **キャッシュのキーは jawiki 記事タイトル**（ゲーム名ではない）。主経路が
// 「記事 → Q-ID → Wikidata の IGDB ID → ジャケ」なので、記事タイトルが自然な単位になる。
// 記事が無い行（全体の約12%）はジャケが付かない。
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  emptyIgdbStats,
  fetchCoversBySlug,
  fetchIgdbSlugs,
  hasIgdbCreds,
  igdbBanned,
  isCached,
  resolveCovers,
  type CoverTarget,
  type IgdbCache,
} from "./sources/igdb";
import { readState } from "./lib/state";

const ROOT = process.cwd();
const GAMES_PATH = path.join(ROOT, "src", "data", "games.json");
const OUT_PATH = path.join(ROOT, "src", "data", "igdb.json");

type GameSeedRow = { name: string; title?: string; year: number };

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function save(cache: IgdbCache): void {
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(cache, null, 0)}\n`);
}

/** ラテン文字が主体の名前か（IGDB の search は日本語クエリに 0 件しか返さないため）。 */
function isLatinName(s: string): boolean {
  const letters = [...s].filter((c) => /\S/.test(c));
  if (letters.length === 0) return false;
  return letters.filter((c) => /[A-Za-z0-9]/.test(c)).length / letters.length >= 0.6;
}

async function run(): Promise<void> {
  const rows = readJson<GameSeedRow[]>(GAMES_PATH, []);
  if (rows.length === 0) {
    console.error("[covers] src/data/games.json が空です。先に npm run import:games を実行してください。");
    process.exit(1);
  }
  const cache = readJson<IgdbCache>(OUT_PATH, {});
  const before = Object.values(cache).filter((e) => e.id).length;

  if (!hasIgdbCreds()) {
    console.warn(
      "[covers] IGDB_CLIENT_ID / IGDB_CLIENT_SECRET が未設定なので解決をスキップします" +
        `（キャッシュ済み ${before} 件はそのまま使えます）。` +
        " キーは https://dev.twitch.tv/console/apps で無料で取得できます。",
    );
    return;
  }

  // jawiki 記事タイトル（ユニーク）と、同名記事の代表年（初出＝オリジナル）。
  const state = readState();
  const byTitle = new Map<string, { year: number; name: string }>();
  for (const r of rows) {
    if (!r.title) continue;
    const hit = byTitle.get(r.title);
    if (!hit || r.year < hit.year) byTitle.set(r.title, { year: r.year, name: r.name });
  }
  const todo = [...byTitle.keys()].filter((t) => !isCached(t, cache));
  console.log(`[covers] 記事タイトル ${byTitle.size}件（解決済み ${before} / 未取得 ${todo.length}）`);

  const stats = emptyIgdbStats();

  // ---- 主経路: Q-ID → Wikidata の IGDB ID(P5794) → slug 一括引き ----
  // IGDB の search は日本語クエリに 0 件しか返さないので、これが本命。照合は不要
  // （Wikidata 側で人手により紐づけられている）。
  const qidOf = new Map<string, string>();
  for (const t of todo) {
    const q = state.pages[t]?.qid;
    if (q) qidOf.set(t, q);
  }
  console.log(`[covers] Wikidata 段: Q-ID を持つ ${qidOf.size}件を引きます…`);
  const slugByQid = await fetchIgdbSlugs([...new Set(qidOf.values())]);
  console.log(`[covers]   IGDB ID(P5794) あり ${slugByQid.size}件 → IGDB でジャケを引きます…`);
  const coverBySlug = await fetchCoversBySlug([...new Set(slugByQid.values())]);

  const searched = new Set<string>();
  for (const [title, qid] of qidOf) {
    const slug = slugByQid.get(qid);
    const cover = slug ? coverBySlug.get(slug) : undefined;
    if (cover) {
      cache[title] = { id: cover };
      stats.resolved++;
      searched.add(title);
    }
  }
  save(cache);
  console.log(`[covers] Wikidata 段 完了: ジャケ ${stats.resolved}件`);

  // ---- 保険: ラテン文字名は search でも引ける（日本語は引けないので対象外）----
  const searchMax = Number(process.env.IGDB_SEARCH_MAX ?? 400);
  if (searchMax > 0 && !igdbBanned()) {
    const rest: CoverTarget[] = todo
      .filter((t) => !searched.has(t) && isLatinName(byTitle.get(t)!.name))
      .slice(0, searchMax)
      .map((t) => ({ name: byTitle.get(t)!.name, year: byTitle.get(t)!.year, key: t }));
    console.log(`[covers] search 段: ラテン文字名 ${rest.length}件を1件ずつ引きます…`);
    for (let i = 0; i < rest.length; i += 50) {
      await resolveCovers(rest.slice(i, i + 50), cache, stats);
      save(cache);
      if (igdbBanned()) break;
    }
  }

  const after = Object.values(cache).filter((e) => e.id).length;
  console.log(
    `[covers] 完了: ジャケあり ${after}/${byTitle.size}件（${((after / byTitle.size) * 100).toFixed(0)}%）` +
      ` / 今回 +${after - before} / 失敗${stats.failed}`,
  );
  console.log("[covers] 反映は GAMES_ONLY=1 npm run aggregate");
}

run().catch((e) => {
  console.error("[covers] 致命的エラー:", e);
  process.exit(1);
});
