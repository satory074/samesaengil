// ゲームのジャケット画像を IGDB（Twitch）で解決する。設計は sources/spotify.ts の写し。
//
// 資格情報（IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）が無ければ解決はスキップし、キャッシュ済みの
// 分だけ埋める＝表示側は Steam 由来のジャケか 🎮 プレースホルダにフォールバックする。
// 解決結果は src/data/igdb.json（"ゲーム名" -> {id}、{id:""} は「IGDB に無い」の負キャッシュ）。
//
// なぜ IGDB か: 日本語版Wikipedia は非自由画像を置けないためジャケが存在せず（キャッシュ済み
// 画像は 2% で、しかも『プリキュアの電車』のような別物）、任天堂公式 eShop は 1枚 1.6MB で
// リサイズ不可＋レトロは画像自体が無い。IGDB はレトロ含めて網羅性があり、サムネ専用 URL が軽い
// （t_cover_small で実測 3.8KB）。画像 CDN 自体は認証不要。
import { fetchJson, HttpError, sleep, USER_AGENT } from "../lib/util";
import { normalizeTitle, titlesMatch } from "./steamStore";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API_URL = "https://api.igdb.com/v4/games";

/** 解決できた/できなかった/失敗した件数（サイレント破損の検知用）。 */
export interface IgdbStats {
  resolved: number;
  missing: number;
  cached: number;
  failed: number;
  skipped: number;
}

export function emptyIgdbStats(): IgdbStats {
  return { resolved: 0, missing: 0, cached: 0, failed: 0, skipped: 0 };
}

export function hasIgdbCreds(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

/** キャッシュ値。id が空文字なら「IGDB に無い」の負キャッシュ。 */
export interface IgdbEntry {
  /** cover の image_id（例 "co1r7f"）。URL は表示側で組み立てる。 */
  id: string;
}

export type IgdbCache = Record<string, IgdbEntry>;

/** 解決したいゲーム 1 件（年は同名リメイクの取り違えを避けるために使う）。 */
export interface CoverTarget {
  name: string;
  year: number;
}

// ---- 共有セマフォ（別ホストなので gate:false でグローバルゲートを外し、ここで絞る）----
// IGDB の公表上限は 4 req/秒・同時 8。開始間隔 250ms＝4 req/秒 に合わせる。
const CONCURRENCY = Math.max(1, Number(process.env.IGDB_CONCURRENCY ?? 4));
const MIN_GAP_MS = Math.max(0, Number(process.env.IGDB_MIN_GAP_MS ?? 250));
const MAX_429_WAIT_MS = 60_000;

let nextSlot = 0;
async function pace(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP_MS;
  if (start > now) await sleep(start - now);
}
let active = 0;
const queue: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}
function release(): void {
  const next = queue.shift();
  if (next) next();
  else active--;
}

// ---- アクセストークン（約60日有効。401 が返ったら 1 回だけ取り直す）----
let tokenPromise: Promise<string> | null = null;
async function getToken(force = false): Promise<string> {
  if (force) tokenPromise = null;
  tokenPromise ??= (async () => {
    const params = new URLSearchParams({
      client_id: process.env.IGDB_CLIENT_ID ?? "",
      client_secret: process.env.IGDB_CLIENT_SECRET ?? "",
      grant_type: "client_credentials",
    });
    const res = await fetch(`${TOKEN_URL}?${params.toString()}`, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`IGDB token: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("IGDB token: access_token が返らない");
    return data.access_token;
  })();
  try {
    return await tokenPromise;
  } catch (e) {
    tokenPromise = null; // 失敗を握り続けない
    throw e;
  }
}

interface IgdbGame {
  name?: string;
  alternative_names?: { name?: string }[];
  cover?: { image_id?: string };
  first_release_date?: number; // UNIX 秒
}

/** APIcalypse のクエリ文字列に埋めるための引用符エスケープ。 */
function quote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** IGDB の候補から採るものを選ぶ純関数（smoketest 対象）。 */
export function pickCover(games: IgdbGame[], target: CoverTarget): IgdbEntry {
  const want = normalizeTitle(target.name);
  const namesOf = (g: IgdbGame): string[] =>
    [g.name ?? "", ...(g.alternative_names ?? []).map((a) => a.name ?? "")].filter(Boolean);
  const yearOf = (g: IgdbGame): number | null =>
    g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;

  const withCover = games.filter((g) => g.cover?.image_id);
  // 完全一致 → 発売年が ±1 年 → 包含一致 の順に絞る。包含一致だけで先頭を採ると
  // 続編や別名義の作品が当たる（steamStore で『Slay the Spire』に続編が当たった実例と同じ）。
  const exact = withCover.filter((g) => namesOf(g).some((n) => normalizeTitle(n) === want));
  const sameYear = exact.filter((g) => {
    const y = yearOf(g);
    return y !== null && Math.abs(y - target.year) <= 1;
  });
  const hit =
    sameYear[0] ??
    exact[0] ??
    withCover.filter((g) => namesOf(g).some((n) => titlesMatch(n, target.name)))[0];
  return { id: hit?.cover?.image_id ?? "" };
}

async function searchCover(target: CoverTarget): Promise<IgdbEntry> {
  // search はフリーテキスト。日本語タイトルは alternative_names 側に入っていることが多いので
  // どちらも取り、照合は結果側で行う（spotify.ts と同じ流儀）。
  const body =
    `search "${quote(target.name)}"; ` +
    "fields name,alternative_names.name,cover.image_id,first_release_date; limit 10;";
  const call = async (token: string): Promise<IgdbGame[]> =>
    fetchJson<IgdbGame[]>(API_URL, {
      gate: false,
      retries: 3,
      max429WaitMs: MAX_429_WAIT_MS,
      method: "POST",
      body,
      headers: {
        "Client-ID": process.env.IGDB_CLIENT_ID ?? "",
        Authorization: `Bearer ${token}`,
      },
    });

  let games: IgdbGame[];
  try {
    games = await call(await getToken());
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
    games = await call(await getToken(true)); // トークン期限切れ
  }
  return pickCover(games ?? [], target);
}

// 429（レート上限）を一度でも観測したらこの実行では以降を全部スキップする。
// 呼び出し側はチャンクごとに resolveCovers を呼ぶので、モジュール変数で持たないと効かない。
let banned = false;

/** この実行で 429 を観測したか（呼び出し側がチャンクのループを打ち切るのに使う）。 */
export function igdbBanned(): boolean {
  return banned;
}

/** キャッシュ済み（＝問い合わせ不要）か。IGDB_RECHECK=1 のときは負キャッシュも対象外にする。 */
export function isCached(name: string, cache: IgdbCache): boolean {
  const hit = cache[name];
  if (!hit) return false;
  return !(process.env.IGDB_RECHECK === "1" && hit.id === "");
}

/**
 * 渡されたゲームを IGDB に問い合わせ、cache を破壊的に埋める（キャッシュ済みは呼ぶ前に除くこと）。
 * 1 実行の総量制限とチャンクごとの途中保存は呼び出し側（importGameCovers.ts）の責務。
 * 失敗はキャッシュしない＝次回また試す。
 */
export async function resolveCovers(targets: CoverTarget[], cache: IgdbCache, stats: IgdbStats): Promise<void> {
  const run = async (t: CoverTarget): Promise<void> => {
    await acquire();
    try {
      if (banned) {
        stats.skipped++;
        return;
      }
      await pace();
      const entry = await searchCover(t);
      cache[t.name] = entry;
      if (entry.id) stats.resolved++;
      else stats.missing++;
    } catch (e) {
      stats.failed++;
      if (!banned && e instanceof HttpError && e.status === 429) {
        banned = true;
        console.warn("[covers] 429（レート上限）を検知。この実行では以降をスキップします（次回再試行）");
      }
      // 失敗はキャッシュしない（次回また試す）
    } finally {
      release();
    }
  };
  await Promise.all(targets.map(run));
}
