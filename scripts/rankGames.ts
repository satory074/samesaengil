// games.json に出てくるゲーム記事の「人気」＝日本語版Wikipedia の年間閲覧数を state.json に貯める
// だけの薄い CLI（rankWorks.ts のゲーム版）。1日あたり最大340本になる一覧の並び順に使う。
//
//   npm run rank:games                     … 未解決のタイトルを解決（初回は 2.7 万件で 40 分前後）
//   RANK_GAMES_MAX=3000 npm run rank:games … 1 実行で解決する上限（残りは次回に持ち越し）
//   GAMES_ONLY=1 npm run aggregate         … その人気で全366日の games を並べ替え（数秒）
//
// 初回は長いので **未解決ぶんだけをチャンクに割り、チャンクごとに state.json へ途中保存**する
// （aggregate が 20 日ごとに writeState するのと同じ発想）。途中で止めても次回は続きから。
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { readState, resolveWorkFame, writeState, type State } from "./lib/state";

type GameSeedRow = { title?: string };

/** 1 チャンクの件数。これごとに state.json を書き出す。 */
const CHUNK = Number(process.env.RANK_GAMES_CHUNK ?? 500);
/** 1 実行で解決する上限（0 = 無制限）。長時間実行が止められる環境で刻むため。 */
const MAX = Number(process.env.RANK_GAMES_MAX ?? 0);

/** state に閲覧数まで入っているか（記事なしの負キャッシュも「解決済み」とみなす）。 */
function isResolved(title: string, state: State): boolean {
  const page = state.pages[title];
  if (page === undefined) return false;
  const canon = page.title;
  return canon === undefined || canon in state.views;
}

async function run(): Promise<void> {
  const seedPath = path.join(process.cwd(), "src", "data", "games.json");
  let seeds: GameSeedRow[] = [];
  try {
    seeds = JSON.parse(fs.readFileSync(seedPath, "utf8")) as GameSeedRow[];
  } catch {
    console.error("[games] src/data/games.json が読めません。先に npm run import:games を実行してください。");
    process.exit(1);
  }

  const state = readState();
  const titles = [...new Set(seeds.map((g) => g.title).filter((t): t is string => Boolean(t)))];
  let todo = titles.filter((t) => !isResolved(t, state));
  const carried = MAX > 0 && todo.length > MAX ? todo.length - MAX : 0;
  if (carried) todo = todo.slice(0, MAX);
  console.log(`[games] ${titles.length}タイトル中 未解決${todo.length + carried}件（今回は${todo.length}件、持ち越し${carried}件）…`);

  for (let i = 0; i < todo.length; i += CHUNK) {
    await resolveWorkFame(todo.slice(i, i + CHUNK), state);
    writeState(state); // 途中保存（落ちてもここまでのキャッシュは残る）
    console.log(`  …${Math.min(i + CHUNK, todo.length)}/${todo.length}`);
  }

  const fame = await resolveWorkFame(titles, state, true); // キャッシュから読むだけ
  const ranked = [...fame.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  console.log(`[games] 閲覧数あり${ranked.length} / ${titles.length}タイトル${carried ? `（未解決${carried}件は次回）` : "（全件解決）"}`);
  console.log("[games] 上位10タイトル:");
  for (const [t, v] of ranked.slice(0, 10)) console.log(`  ${v.toLocaleString()}  ${t}`);
}

run().catch((e) => {
  console.error("[games] 致命的エラー:", e);
  process.exit(1);
});
