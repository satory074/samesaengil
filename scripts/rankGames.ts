// games.json に出てくるゲーム記事の「人気」＝日本語版Wikipedia の年間閲覧数を state.json に貯める
// だけの薄い CLI（rankWorks.ts のゲーム版）。1日あたり最大数百本になる一覧の並び順に使う。
//
//   npm run rank:games              … 未キャッシュのタイトルだけ解決（初回は 20〜40 分、以降はほぼ 0 秒）
//   GAMES_ONLY=1 npm run aggregate  … その人気で全366日の games を並べ替え（数秒）
//
// 通常の `npm run aggregate`（フル）も同じ経路で自動的にトップアップするので、
// このスクリプトは「人物を再取得せずにゲームの並び順だけ更新したい」ときの近道。
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { readState, resolveWorkFame, writeState } from "./lib/state";

type GameSeedRow = { title?: string };

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
  const known = titles.filter((t) => state.pages[t] !== undefined).length;
  console.log(`[games] ${titles.length}タイトル（キャッシュ済み${known}） の閲覧数を解決します…`);

  const fame = await resolveWorkFame(titles, state);
  writeState(state);

  const ranked = [...fame.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  console.log(`[games] 完了: 閲覧数あり${ranked.length} / 記事なし${titles.length - ranked.length}`);
  console.log("[games] 上位10タイトル:");
  for (const [t, v] of ranked.slice(0, 10)) console.log(`  ${v.toLocaleString()}  ${t}`);
}

run().catch((e) => {
  console.error("[games] 致命的エラー:", e);
  process.exit(1);
});
