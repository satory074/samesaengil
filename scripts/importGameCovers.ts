// ゲームのジャケット画像（IGDB の cover image_id）を src/data/igdb.json に貯める取込スクリプト。
// 成果物はコミットする（aggregate は実行時に第三者サイトへ依存しない）。
//
//   npm run import:covers               … 未取得を上限まで解決（既定 800件/実行）
//   IGDB_MAX=300 npm run import:covers  … 1 実行の上限。残りは次回に持ち越し
//   IGDB_RECHECK=1 npm run import:covers … 「IGDB に無い」の負キャッシュも引き直す
//   GAMES_ONLY=1 npm run aggregate      … 全366日へ反映（数秒）
//
// 資格情報（IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）が無ければ何もせず終わる＝表示側は
// Steam 由来のジャケか 🎮 プレースホルダのまま（他ソースと同じ graceful degradation）。
//
// **人気（ゲーム記事の年間閲覧数）降順に処理する**——初期表示は各日の先頭30本なので、
// 途中で止めても「見えるところから埋まる」（importCharacterImages.ts と同じ理由）。
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  emptyIgdbStats,
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

/** チャンクごとに igdb.json を書き出す（長時間ランが止められても進捗を失わない）。 */
const CHUNK = Math.max(1, Number(process.env.IGDB_CHUNK ?? 50));

type GameSeedRow = { name: string; title?: string; year: number };

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** ゲーム名（ユニーク）を人気降順に。同名は最も古い年を代表にする（初出＝オリジナル）。 */
function targetsByFame(rows: GameSeedRow[]): CoverTarget[] {
  const state = readState();
  const byName = new Map<string, { year: number; title?: string }>();
  for (const r of rows) {
    if (!r.name) continue;
    const hit = byName.get(r.name);
    if (!hit || r.year < hit.year) byName.set(r.name, { year: r.year, title: r.title ?? hit?.title });
  }
  const fameOf = (title?: string): number => (title ? (state.views[state.pages[title]?.title ?? ""] ?? 0) : 0);
  return [...byName.entries()]
    .map(([name, v]) => ({ name, year: v.year, fame: fameOf(v.title) }))
    .sort((a, b) => b.fame - a.fame || a.name.localeCompare(b.name, "ja"))
    .map(({ name, year }) => ({ name, year }));
}

async function run(): Promise<void> {
  const rows = readJson<GameSeedRow[]>(GAMES_PATH, []);
  if (rows.length === 0) {
    console.error("[covers] src/data/games.json が空です。先に npm run import:games を実行してください。");
    process.exit(1);
  }
  const cache = readJson<IgdbCache>(OUT_PATH, {});
  const withCover = Object.values(cache).filter((e) => e.id).length;

  if (!hasIgdbCreds()) {
    console.warn(
      "[covers] IGDB_CLIENT_ID / IGDB_CLIENT_SECRET が未設定なので解決をスキップします" +
        `（キャッシュ済み ${withCover} 件はそのまま使えます）。` +
        " キーは https://dev.twitch.tv/console/apps で無料で取得できます。",
    );
    return;
  }

  const all = targetsByFame(rows);
  const todo = all.filter((t) => !isCached(t.name, cache));
  const max = Math.max(1, Number(process.env.IGDB_MAX ?? 800));
  const batch = todo.slice(0, max);
  console.log(
    `[covers] ゲーム名 ${all.length}件（解決済み ${withCover} / 未取得 ${todo.length}）。` +
      `今回は人気順に ${batch.length}件を解決します…`,
  );

  const stats = emptyIgdbStats();
  for (let i = 0; i < batch.length; i += CHUNK) {
    await resolveCovers(batch.slice(i, i + CHUNK), cache, stats);
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(cache, null, 0)}\n`);
    console.log(`  …${Math.min(i + CHUNK, batch.length)}/${batch.length}（ジャケあり ${stats.resolved}）`);
    if (igdbBanned()) break;
  }

  const rate = stats.resolved + stats.missing > 0 ? stats.resolved / (stats.resolved + stats.missing) : 0;
  console.log(
    `[covers] 完了: 新規ジャケ${stats.resolved} / IGDB未収録${stats.missing}（ヒット率 ${(rate * 100).toFixed(0)}%）` +
      ` / 失敗${stats.failed} / スキップ${stats.skipped} / 持ち越し${Math.max(0, todo.length - batch.length)}`,
  );
  console.log("[covers] 反映は GAMES_ONLY=1 npm run aggregate");
}

run().catch((e) => {
  console.error("[covers] 致命的エラー:", e);
  process.exit(1);
});
