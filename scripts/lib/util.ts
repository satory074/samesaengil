// ビルドスクリプト共通ユーティリティ（fetch・リトライ・並列制御）。

// Wikimedia API は説明的な User-Agent を要求する（連絡先つき）。
export const USER_AGENT =
  "samesaengil/0.1 (https://github.com/satory074/samesaengil; satory074@gmail.com)";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface FetchOpts {
  /** ミリ秒。既定 20000。 */
  timeout?: number;
  /** リトライ回数。既定 4。 */
  retries?: number;
  /** 追加ヘッダ。 */
  headers?: Record<string, string>;
}

// --- グローバルなリクエスト調停（Wikimedia の 429 対策）---
// 呼び出し側の並列度に関係なく、同時実行数と「開始間隔」を全体で制限する。
const MAX_CONCURRENT = Number(process.env.AGG_MAX_CONCURRENT ?? 2);
const MIN_GAP_MS = Number(process.env.AGG_MIN_GAP_MS ?? 200);
let active = 0;
let nextSlot = 0; // 次にリクエストを開始してよい時刻（ms epoch）
const waiters: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    const tryRun = (): void => {
      if (active < MAX_CONCURRENT) {
        active++;
        const now = Date.now();
        const start = Math.max(now, nextSlot);
        nextSlot = start + MIN_GAP_MS; // 開始時刻を MIN_GAP ずつずらす
        const delay = start - now;
        if (delay > 0) setTimeout(resolve, delay);
        else resolve();
      } else {
        waiters.push(tryRun);
      }
    };
    tryRun();
  });
}

function releaseSlot(): void {
  active--;
  waiters.shift()?.();
}

async function fetchWithTimeout(url: string, opts: FetchOpts): Promise<Response> {
  await acquireSlot();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout ?? 20000);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, ...opts.headers },
    });
  } finally {
    clearTimeout(t);
    releaseSlot();
  }
}

/** 429 のとき待つべきミリ秒（Retry-After 優先、無ければ指数的に伸ばす）。 */
function backoff429(res: Response, attempt: number): number {
  const ra = Number(res.headers.get("retry-after"));
  const base = ra > 0 ? ra * 1000 : 1500 * (attempt + 1);
  return base + Math.floor(Math.random() * 400); // ジッタ
}

/** JSON を取得。429/失敗時はリトライ（指数バックオフ＋Retry-After）。最終的に失敗したら throw。 */
export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, { ...opts, headers: { Accept: "application/json", ...opts.headers } });
      if (res.status === 429) {
        if (i < retries) {
          await sleep(backoff429(res, i));
          continue;
        }
        throw new Error(`HTTP 429 for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** テキストを取得（HTML スクレイプ用）。 */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, opts);
      if (res.status === 429) {
        if (i < retries) {
          await sleep(backoff429(res, i));
          continue;
        }
        throw new Error(`HTTP 429 for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(800 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 配列を limit 並列で処理。 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** 50 件ずつのチャンクに分割。 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
