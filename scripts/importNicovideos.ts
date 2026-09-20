// ミリオン（100万再生）達成ニコニコ動画の取込。成果物 src/data/nicovideos.json はコミットする
// （aggregate は実行時に第三者サイトへ依存しない。importGames.ts / importKinenbi.ts と同じ流儀）。
//
//   npm run import:nico                        … 2006年〜今年を全部取り直して上書き（~2分）
//   npx tsx scripts/importNicovideos.ts 2013   … 指定年だけ（デバッグ。ファイルは書かない）
//   NICO_MIN_GAP_MS=2000 npm run import:nico   … リクエストの開始間隔（既定 1200ms）
//
// 年ごとにページングするのは、(1) 1回の _offset を小さく保てる、(2) 失敗した年だけ前回値に
// 戻せる（＝週次 CI でサイトが不調でも全体が空にならない）ため。importGames.ts の
// 「機種ごとに前回値フォールバック」と同じ単位の切り方。
import fs from "node:fs";
import path from "node:path";
import {
  emptyNicoStats,
  fetchMillionVideosOfYear,
  nicoBanned,
  type NicoSeed,
} from "./sources/nicoSnapshot";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "src", "data", "nicovideos.json");

/** ニコニコ動画のサービス開始は 2006年12月（ミリオン到達の最古は 2007年3月）。 */
const NICO_FROM = 2006;
/** 前回比でこれ以上減っていたら取得失敗とみなして前回値を維持する（パーサ/API 破損の検知）。 */
const DROP_LIMIT = 0.2;
/** ただし母数が小さい年（最近の年は数本）は割合で判定しない。 */
const DROP_MIN_PREV = 20;

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 指定があればその年だけ（デバッグ実行＝ファイル未書込）。 */
function selectYears(thisYear: number): { list: number[]; debug: boolean } {
  const all = Array.from({ length: thisYear - NICO_FROM + 1 }, (_, i) => NICO_FROM + i);
  const args = [...process.argv.slice(2), ...(process.env.NICO_ONLY_YEARS ?? "").split(/[,\s]+/)]
    .filter(Boolean)
    .map(Number)
    .filter((y) => y >= NICO_FROM && y <= thisYear);
  if (!args.length) return { list: all, debug: false };
  return { list: [...new Set(args)].sort((a, b) => a - b), debug: true };
}

/** 前回の nicovideos.json を投稿年ごとに索引（取得 0 件の年を空で上書きしないため）。 */
function readPrevByYear(): Map<number, NicoSeed[]> {
  const prev = readJson<NicoSeed[]>(OUT_PATH, []);
  const map = new Map<number, NicoSeed[]>();
  for (const row of prev) {
    const bucket = map.get(row.year);
    if (bucket) bucket.push(row);
    else map.set(row.year, [row]);
  }
  return map;
}

/** 1 オブジェクト 1 行（git diff を読める状態に保つ。games.json と同じ）。 */
function serialize(rows: NicoSeed[]): string {
  return `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
}

async function run(): Promise<void> {
  const thisYear = new Date().getFullYear();
  const { list, debug } = selectYears(thisYear);
  const prev = readPrevByYear();
  const stats = emptyNicoStats();
  const kept: number[] = [];
  const rows: NicoSeed[] = [];

  console.log(
    `[nico] ${list[0]}〜${list[list.length - 1]}年のミリオン動画を取得します${debug ? "（デバッグ実行: ファイルは書きません）" : ""}…`,
  );

  for (const year of list) {
    const before = prev.get(year) ?? [];
    let got: NicoSeed[] = [];
    try {
      if (nicoBanned()) throw new Error("429 を観測済み");
      got = await fetchMillionVideosOfYear(year, stats);
    } catch (e) {
      console.warn(`  ${year}年: 取得失敗（${e instanceof Error ? e.message : String(e)}）`);
    }
    // 0 件・大幅減はどちらも「取れなかった」扱い。再生数は減らないので、ミリオン動画が
    // 週をまたいで 2 割減ることは構造的に起こらない（起きたら API 側の異常）。
    const shrank = before.length >= DROP_MIN_PREV && got.length < before.length * (1 - DROP_LIMIT);
    if ((!got.length || shrank) && before.length) {
      kept.push(year);
      rows.push(...before);
      const why = got.length ? `${before.length}本→${got.length}本と減った` : "0件だった";
      console.warn(`  ${year}年: ${why}ので前回値（${before.length}本）を維持します`);
      continue;
    }
    const added = got.length - before.length;
    console.log(`  ${year}年: ${got.length}本${before.length ? `（前回 ${before.length}本 / ${added >= 0 ? "+" : ""}${added}）` : ""}`);
    rows.push(...got);
  }

  // デバッグ実行では触らなかった年を落としてしまうので、全年を回したときだけ書き出す。
  if (debug) {
    for (const r of rows.slice(0, 20)) console.log(`  ${r.year}-${r.month}-${r.day} ${r.man}万 ${r.title} [${r.id}]`);
    console.log(`[nico] 計 ${rows.length}本 / リクエスト ${stats.requests}回（デバッグ実行なので書きません）`);
    return;
  }

  rows.sort((a, b) => a.month - b.month || a.day - b.day || b.man - a.man || a.id.localeCompare(b.id));
  if (kept.length) console.warn(`[nico] ⚠ 前回値を維持した年: ${kept.join(", ")}`);
  console.log(`[nico] 合計 ${rows.length}本（リクエスト ${stats.requests}回）`);
  fs.writeFileSync(OUT_PATH, serialize(rows));
  console.log(`[nico] ${OUT_PATH} を書き出しました`);
}

run().catch((e) => {
  console.error("[nico] 致命的エラー:", e);
  process.exit(1);
});
