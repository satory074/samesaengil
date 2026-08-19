// kinenbi.gr.jp（日本記念日協会）から全366日ぶんの記念日を取り込み、src/data/kinenbi.json に書き出す。
// 他の import と違い**週次 CI でも実行**される（新しい認定記念日を拾うため）。aggregate は
// この成果物を読むだけで第三者サイトには実行時依存しない。生成物はコミットする。
//
// 実行:
//   npm run import:kinenbi                … 全366日を取得してファイルへ書き出し
//   npx tsx scripts/importKinenbi.ts 01-01 10-10
//                                         … 指定日のみ（デバッグ）。コンソール出力のみ・ファイルは上書きしない
//   ONLY_DAYS=01-01 npm run import:kinenbi … 同上（env 指定）
import fs from "node:fs";
import path from "node:path";
import { mapLimit } from "./lib/util";
import { fetchKinenbiDay, type KinenbiEntry } from "./sources/kinenbiDay";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "src", "data", "kinenbi.json");

const pad = (n: number): string => String(n).padStart(2, "0");
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Day {
  month: number;
  day: number;
}
type SeedRow = KinenbiEntry & Day;

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

/** 既存の kinenbi.json を MM-DD -> 行 に集約（前回値フォールバック用）。 */
function readPrev(): Map<string, SeedRow[]> {
  const map = new Map<string, SeedRow[]>();
  let rows: SeedRow[];
  try {
    rows = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) as SeedRow[];
  } catch {
    return map;
  }
  for (const r of rows) {
    const key = `${pad(r.month)}-${pad(r.day)}`;
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return map;
}

/** 配列を 1 オブジェクト 1 行の JSON 文字列に（git diff を読みやすく保つ）。 */
function serialize(rows: SeedRow[]): string {
  return "[\n" + rows.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n";
}

async function run(): Promise<void> {
  const { days, debug } = selectDays();
  const concurrency = Number(process.env.KINENBI_CONCURRENCY ?? 2); // 実効はグローバルゲート（同時2）で律速
  console.log(`[import:kinenbi] ${days.length}日ぶんを取得します（並列${concurrency}）…`);

  // 週次 CI で回るので、サイト障害時に既存データを空で上書きしない（取得0件の日は前回値を維持）。
  const prev = readPrev();
  const empties: string[] = [];
  let kept = 0;
  let done = 0;

  const perDay = await mapLimit(days, concurrency, async ({ month, day }) => {
    const key = `${pad(month)}-${pad(day)}`;
    const entries = await fetchKinenbiDay(month, day);
    done++;
    if (debug) {
      console.log(`  ${key}: ${entries.length}件`);
      for (const e of entries) console.log(`    ${e.name}${e.other ? "（その他）" : ""} #${e.id}`);
    } else if (done % 20 === 0) {
      console.log(`  …${done}/${days.length}`);
    }
    if (entries.length === 0) {
      const before = prev.get(key) ?? [];
      if (before.length > 0) {
        kept++;
        return before;
      }
      empties.push(key);
      return [];
    }
    return entries.map((e) => ({ ...e, month, day }) as SeedRow);
  });

  const rows = perDay.flat();
  console.log(
    `[import:kinenbi] 合計 ${rows.length}件 / 新規取得${days.length - kept - empties.length}日` +
      ` / 前回維持${kept}日 / 0件のまま${empties.length}日`,
  );
  if (empties.length) console.warn(`  0件の日: ${empties.join(", ")}`);

  if (debug) {
    console.log("[import:kinenbi] デバッグ実行のためファイルは書き出しません。");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, serialize(rows));
  console.log(`[import:kinenbi] 書き出し: ${path.relative(ROOT, OUT_PATH)}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
