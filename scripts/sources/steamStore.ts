// Steam 公式ストア API から PC ゲームの発売日を引く（キー不要・日本語対応）。
//
// 日本語版 Wikipedia には「Steam のゲームタイトル一覧」に相当する記事が無いため、PC ゲームだけは
// 公式ストアを直接引く。候補タイトルは jawiki の「Category:YYYY年のコンピュータゲーム」から採る
// （＝記事があるくらい知られている作品に絞る）ので、ここでは「名前 → 発売日」を解決するだけ。
//
// 設計は sources/spotify.ts をそのまま踏襲する:
//   ・フリーテキスト検索 → **結果側で名前を照合**（ストアの検索は表記ゆれに寛容だが誤爆もする）
//   ・正/負の両方をキャッシュ（src/data/steam.json）。ネットワーク失敗はキャッシュせず次回再試行
//   ・1 実行あたりの送信上限で打ち切り、残りは次回（＝週次 cron）に持ち越す
//   ・429 を一度でも観測したらその実行は以降スキップ（サーキットブレーカー）
import { HttpError, fetchJson, sleep } from "../lib/util";

const SEARCH = "https://store.steampowered.com/api/storesearch/";
const DETAILS = "https://store.steampowered.com/api/appdetails";

/** キャッシュ 1 件。appid:0 は「Steam に見つからなかった」の負キャッシュ。 */
export interface SteamEntry {
  appid: number;
  /** ストア上の名前（照合結果の確認用）。 */
  name?: string;
  /** 発売日 "YYYY-MM-DD"。日まで分からなければ空。 */
  date?: string;
}

export type SteamCache = Record<string, SteamEntry>;

export interface SteamStats {
  resolved: number;
  missing: number;
  cached: number;
  failed: number;
  skipped: number;
}

export function emptySteamStats(): SteamStats {
  return { resolved: 0, missing: 0, cached: 0, failed: 0, skipped: 0 };
}

/** 照合用の正規化（NFKC → 小文字 → 記号と空白を落とす）。spotify.ts と同じ考え方。 */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[-–—~〜～:：;；,，.。・/／\\|｜'"“”‘’!！?？&＆+＋*＊#＃@＠()（）[\]【】<>《》「」『』]/g, "");
}

/** 一方が他方を含んでいれば同一とみなす（副題の有無を吸収する緩い一致）。 */
export function titlesMatch(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** 「2022年2月24日」「2022年2月」「24 Feb, 2022」を YYYY-MM-DD に。日が無ければ null。 */
export function parseSteamDate(s: string): string | null {
  const ja = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(s);
  if (ja) return `${ja[1]}-${String(Number(ja[2])).padStart(2, "0")}-${String(Number(ja[3])).padStart(2, "0")}`;
  const en = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})$/.exec(s.trim());
  if (en) {
    const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      en[2].toLowerCase(),
    );
    if (mi >= 0) return `${en[3]}-${String(mi + 1).padStart(2, "0")}-${String(Number(en[1])).padStart(2, "0")}`;
  }
  return null;
}

// --- レート調停 ---------------------------------------------------------------
// ストア API は概ね 5 分あたり 200 リクエストで 429 になる。ゲート外（別ホスト）なので
// ここで開始間隔を作る。同時実行は 1 に固定（並べても上限は変わらず 429 を早めるだけ）。
const MIN_GAP_MS = Number(process.env.STEAM_MIN_GAP_MS ?? 1600);
let nextAt = 0;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const start = Math.max(now, nextAt);
  nextAt = start + MIN_GAP_MS;
  if (start > now) await sleep(start - now);
  return fn();
}

interface SearchResponse {
  items?: { id?: number; name?: string; type?: string }[];
}
interface DetailsResponse {
  [appid: string]: {
    success?: boolean;
    data?: { type?: string; name?: string; release_date?: { coming_soon?: boolean; date?: string } };
  };
}

async function searchApp(term: string): Promise<{ id: number; name: string } | null> {
  const params = new URLSearchParams({ term, cc: "jp", l: "japanese" });
  const data = await paced(() =>
    fetchJson<SearchResponse>(`${SEARCH}?${params.toString()}`, { gate: false, retries: 2, max429WaitMs: 60_000 }),
  );
  const items = (data.items ?? []).filter((i): i is { id: number; name: string } => Boolean(i.id && i.name));
  // 完全一致を最優先。包含一致だけで先頭を採ると「Slay the Spire」に続編の
  // 「Slay the Spire 2」が当たる（検索結果は新しい方が上に来ることがある）。
  const want = normalizeTitle(term);
  const exact = items.find((i) => normalizeTitle(i.name) === want);
  if (exact) return { id: exact.id, name: exact.name };
  const loose = items.find((i) => titlesMatch(i.name, term));
  return loose ? { id: loose.id, name: loose.name } : null;
}

async function releaseOf(appid: number): Promise<{ name: string; date: string } | null> {
  const params = new URLSearchParams({ appids: String(appid), cc: "jp", l: "japanese" });
  const data = await paced(() =>
    fetchJson<DetailsResponse>(`${DETAILS}?${params.toString()}`, { gate: false, retries: 2, max429WaitMs: 60_000 }),
  );
  const d = data[String(appid)]?.data;
  if (!d || d.type !== "game") return null; // DLC・体験版・サウンドトラックは除く
  if (d.release_date?.coming_soon) return null;
  const date = parseSteamDate(d.release_date?.date ?? "");
  if (!date) return null;
  return { name: d.name ?? "", date };
}

/**
 * 候補タイトルの発売日を解決してキャッシュを埋める。cache は破壊的に更新する。
 * 上限に達したぶんは触らない（次回実行で続きから）。
 */
export async function resolveSteam(titles: string[], cache: SteamCache, stats: SteamStats): Promise<void> {
  const maxRequests = Number(process.env.STEAM_MAX_REQUESTS ?? 600);
  const recheck = process.env.STEAM_RECHECK === "1";
  let used = 0;
  let banned = false;

  for (const title of titles) {
    const hit = cache[title];
    if (hit && !(recheck && hit.appid === 0)) {
      stats.cached++;
      continue;
    }
    if (banned || used >= maxRequests) {
      stats.skipped++;
      continue;
    }
    used++;
    try {
      const app = await searchApp(title);
      if (!app) {
        cache[title] = { appid: 0 };
        stats.missing++;
        continue;
      }
      used++;
      const rel = await releaseOf(app.id);
      if (!rel) {
        cache[title] = { appid: 0 };
        stats.missing++;
        continue;
      }
      cache[title] = { appid: app.id, name: rel.name, date: rel.date };
      stats.resolved++;
    } catch (e) {
      stats.failed++;
      if (e instanceof HttpError && e.status === 429) {
        banned = true;
        console.warn("[steam] 429 を観測したのでこの実行の残りはスキップします（次回に持ち越し）");
      }
      // 失敗はキャッシュしない（次回自然に再試行）
    }
  }
}

/** Steam ストアのページ URL。 */
export function steamUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`;
}
