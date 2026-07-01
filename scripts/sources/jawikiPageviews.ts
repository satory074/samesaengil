// 日本語版 Wikipedia の記事別ページビュー（閲覧数）を取得＝日本での「人気」指標。
// Wikimedia REST metrics API（ja.wikipedia.org とは別ホスト）をグローバルゲート外で叩く。
// ただし metrics API は 1 IP あたり ~6 並列を超えると 429 を返し始めるため（実測: 6=クリーン,
// 7 で 429 混入, 8 以上は全滅）、日並列(AGG_CONCURRENCY)と無関係に総同時実行数を 6 に抑える
// モジュール共有セマフォを噛ませる。これが無いと 3 日×高並列で 429 の嵐→バックオフで激遅になる。
import { fetchJson } from "../lib/util";

const API =
  "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/all-agents";

interface PvResponse {
  items?: { views?: number }[];
}

// ---- 共有セマフォ（全 fetchPageviews 呼び出しを横断して同時実行数を制限）----
const PV_CONCURRENCY = Math.max(1, Number(process.env.PV_CONCURRENCY ?? 6));
let pvActive = 0;
const pvQueue: Array<() => void> = [];
function pvAcquire(): Promise<void> {
  if (pvActive < PV_CONCURRENCY) {
    pvActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => pvQueue.push(resolve));
}
function pvRelease(): void {
  const next = pvQueue.shift();
  if (next) next(); // 1 つ抜けて 1 つ入るので active は据え置き
  else pvActive--;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const stamp = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}00`;

/** 直近およそ12か月の [start, end]（YYYYMMDD00）。 */
export function last12Months(now: Date): { start: string; end: string } {
  const end = stamp(now);
  const start = stamp(new Date(now.getFullYear() - 1, now.getMonth(), 1));
  return { start, end };
}

/**
 * 正規化済み記事タイトル群 → 期間内の合計閲覧数。
 * 同時実行数は共有セマフォで 6 に固定。データ無し(404)・エラーは 0。
 */
export async function fetchPageviews(
  titles: string[],
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(titles.filter(Boolean))];
  await Promise.all(
    uniq.map(async (title) => {
      await pvAcquire();
      try {
        // encodeURIComponent は空白→%20・スラッシュ→%2F まで含めてエンコードする。
        const url = `${API}/${encodeURIComponent(title)}/monthly/${start}/${end}`;
        const data = await fetchJson<PvResponse>(url, { gate: false, retries: 3 });
        out.set(title, (data.items ?? []).reduce((s, i) => s + (i.views ?? 0), 0));
      } catch {
        out.set(title, 0); // 404（新規記事・データ無し）や境界 429 は 0
      } finally {
        pvRelease();
      }
    }),
  );
  return out;
}
