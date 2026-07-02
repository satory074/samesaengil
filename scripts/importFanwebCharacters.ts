// bd.fan-web.jp から全366日ぶんのキャラを取り込み、src/data/characters-fanweb.json に書き出す。
// これは「一度きり（＋随時再実行）」の取込スクリプト。aggregate はこの成果物を読むだけで
// 第三者サイトには実行時依存しない。生成物はコミットする。
//
// 実行:
//   npm run import:characters             … 全366日を取得してファイルへ書き出し
//   npx tsx scripts/importFanwebCharacters.ts 03-16 07-04
//                                         … 指定日のみ（デバッグ）。コンソール出力のみ・ファイルは上書きしない
//   ONLY_DAYS=03-16 npm run import:characters   … 同上（env 指定）
import fs from "node:fs";
import path from "node:path";
import { mapLimit } from "./lib/util";
import { fetchFanwebCharacters, type FanwebCharacter } from "./sources/fanwebDay";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "src", "data", "characters-fanweb.json");

const pad = (n: number): string => String(n).padStart(2, "0");
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Day {
  month: number;
  day: number;
}
type SeedRow = FanwebCharacter & Day;

function allDays(): Day[] {
  const out: Day[] = [];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= DAYS_IN_MONTH[m - 1]; d++) out.push({ month: m, day: d });
  return out;
}

/** argv / ONLY_DAYS の MM-DD 指定を集める（あればデバッグ＝ファイル未書込）。 */
function selectDays(): { days: Day[]; debug: boolean } {
  const argv = process.argv.slice(2).filter((a) => /^\d{1,2}-\d{1,2}$/.test(a));
  const fromEnv = (process.env.ONLY_DAYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const wanted = new Set([...argv, ...fromEnv].map((s) => {
    const [m, d] = s.split("-").map(Number);
    return `${pad(m)}-${pad(d)}`;
  }));
  if (wanted.size === 0) return { days: allDays(), debug: false };
  return { days: allDays().filter(({ month, day }) => wanted.has(`${pad(month)}-${pad(day)}`)), debug: true };
}

/** 同一日の (name|work) 重複を除去。 */
function dedupe(chars: FanwebCharacter[]): FanwebCharacter[] {
  const seen = new Set<string>();
  const out: FanwebCharacter[] = [];
  for (const c of chars) {
    const k = `${c.name}|${c.work}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** 配列を 1 オブジェクト 1 行の JSON 文字列に（git diff を読みやすく保つ）。 */
function serialize(rows: SeedRow[]): string {
  return "[\n" + rows.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n";
}

async function run(): Promise<void> {
  const { days, debug } = selectDays();
  const concurrency = Number(process.env.FANWEB_CONCURRENCY ?? 4); // 実効はグローバルゲート（同時2）で律速
  console.log(`[import:characters] ${days.length}日ぶんを取得します（並列${concurrency}）…`);

  const empties: string[] = [];
  let done = 0;

  const perDay = await mapLimit(days, concurrency, async ({ month, day }) => {
    const key = `${pad(month)}-${pad(day)}`;
    const chars = dedupe(await fetchFanwebCharacters(month, day));
    if (chars.length === 0) empties.push(key);
    done++;
    if (debug) {
      console.log(`  ${key}: ${chars.length}件`);
      for (const c of chars) console.log(`    ${c.name}（${c.work}）`);
    } else if (done % 20 === 0) {
      console.log(`  …${done}/${days.length}`);
    }
    return chars.map((c) => ({ ...c, month, day }) as SeedRow);
  });

  const rows = perDay.flat();
  console.log(`[import:characters] 合計 ${rows.length}件 / 0件の日: ${empties.length}`);
  if (empties.length) console.warn(`  0件の日: ${empties.join(", ")}`);

  if (debug) {
    console.log("[import:characters] デバッグ実行のためファイルは書き出しません。");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, serialize(rows));
  console.log(`[import:characters] 書き出し: ${path.relative(ROOT, OUT_PATH)}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
