// キャラ seed に出てくる全作品（~7000件）の「人気」＝日本語版Wikipedia の年間閲覧数を
// state.json に貯めるだけの薄い CLI。キャラの並び替え（作品の人気順）に使う。
//
//   npm run rank:works              … 未キャッシュの作品だけ解決（初回は 10〜20 分、以降はほぼ 0 秒）
//   CHARS_ONLY=1 npm run aggregate  … その人気で全366日の characters を並べ替え（数秒）
//
// 通常の `npm run aggregate`（フル）も同じ経路で自動的にトップアップするので、
// このスクリプトは「人物を再取得せずに並び順だけ更新したい」ときの近道。
import "dotenv/config";
import { readState, resolveWorkFame, writeState } from "./lib/state";
import charactersSeed from "../src/data/characters.json";
import fanwebSeed from "../src/data/characters-fanweb.json";

type CharSeedRow = { work: string };

async function run(): Promise<void> {
  const state = readState();
  const works = [
    ...new Set(
      [...(charactersSeed as CharSeedRow[]), ...(fanwebSeed as CharSeedRow[])].map((c) => c.work).filter(Boolean),
    ),
  ];
  const known = works.filter((w) => state.pages[w] !== undefined).length;
  console.log(`[works] ${works.length}作品（キャッシュ済み${known}） の閲覧数を解決します…`);

  const fame = await resolveWorkFame(works, state);
  writeState(state);

  const ranked = [...fame.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  console.log(`[works] 完了: 閲覧数あり${ranked.length} / 記事なし${works.length - ranked.length}`);
  console.log("[works] 上位10作品:");
  for (const [w, v] of ranked.slice(0, 10)) console.log(`  ${v.toLocaleString()}  ${w}`);
}

run().catch((e) => {
  console.error("[works] 致命的エラー:", e);
  process.exit(1);
});
