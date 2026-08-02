// オリコン週間1位の曲を Spotify の曲ページ＋ジャケット画像に解決する（Client Credentials フロー）。
//
// 資格情報（SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET）が無ければ解決はスキップし、
// キャッシュ済みの分だけ埋める＝表示側は検索 URL にフォールバックする（他ソースと同じ graceful degradation）。
// 解決結果は src/data/spotify.json（"曲名|アーティスト" -> {url, cover?}、{url:""} は「Spotify に無い」の負キャッシュ。
// 旧スキーマの string 値（URL のみ）は互換読みし、SPOTIFY_RECHECK=1 で cover 込みに引き直せる）。
import { fetchJson, HttpError, USER_AGENT } from "../lib/util";
import type { ChartWeek } from "../../src/lib/types";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SEARCH_URL = "https://api.spotify.com/v1/search";

/** 見つかった/見つからなかった/失敗した曲数（サイレント破損の検知用）。 */
export interface SpotifyStats {
  resolved: number;
  missing: number;
  failed: number;
}

export function hasSpotifyCreds(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/** キャッシュキー。 */
export function songKey(w: ChartWeek): string {
  return `${w.title}|${w.artist}`;
}

/** キャッシュ値。url が空文字なら「Spotify に無い」の負キャッシュ。 */
export interface SpotifyEntry {
  url: string;
  cover?: string;
}

/** 旧スキーマ（値が URL の string）の互換読み。 */
export function entryOf(v: string | SpotifyEntry): SpotifyEntry {
  return typeof v === "string" ? { url: v } : v;
}

// ---- 共有セマフォ（Wikipedia 用のグローバルゲートとは別ホストなので gate:false で外し、ここで絞る）----
const CONCURRENCY = Math.max(1, Number(process.env.SPOTIFY_CONCURRENCY ?? 4));
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

// ---- アクセストークン（1時間有効。401 が返ったら 1 回だけ取り直す）----
let tokenPromise: Promise<string> | null = null;
async function getToken(force = false): Promise<string> {
  if (force) tokenPromise = null;
  tokenPromise ??= (async () => {
    const basic = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID ?? ""}:${process.env.SPOTIFY_CLIENT_SECRET ?? ""}`,
    ).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Spotify token: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error("Spotify token: access_token が返らない");
    return data.access_token;
  })();
  try {
    return await tokenPromise;
  } catch (e) {
    tokenPromise = null; // 失敗を握り続けない（次の曲で取り直す）
    throw e;
  }
}

/** 照合用の正規化（全角/半角・大小・記号・空白の揺れを吸収）。 */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s'’"“”`・･,、.。!！?？&＆~〜\-–—_/\\()（）[\]［］{}【】「」]/g, "");
}

interface SearchResponse {
  tracks?: {
    items?: {
      name?: string;
      external_urls?: { spotify?: string };
      artists?: { name?: string }[];
      album?: { images?: { url?: string; width?: number }[] };
    }[];
  };
}

/** 短すぎる部分一致での誤爆を避けつつ、表記揺れ（〜Ver. 等）を許容する。 */
function loosely(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
}

/** アルバム画像から表示用の1枚を選ぶ（~300px を狙う。Spotify は通常 640/300/64 を返す）。 */
export function pickCover(images: { url?: string; width?: number }[] | undefined): string {
  if (!images?.length) return "";
  const sized = images.filter((i) => i.width != null);
  const best = sized.length
    ? sized.reduce((a, b) => (Math.abs((a.width ?? 0) - 300) <= Math.abs((b.width ?? 0) - 300) ? a : b))
    : (images[1] ?? images[0]);
  return best?.url ?? "";
}

/** 検索結果から曲を選ぶ。合致なしは {url:""}（Spotify に無い＝負キャッシュ）。 */
export function pickTrack(
  items: NonNullable<NonNullable<SearchResponse["tracks"]>["items"]>,
  w: ChartWeek,
): SpotifyEntry {
  const t = norm(w.title);
  const a = norm(w.artist);
  for (const it of items) {
    const titleOk = loosely(norm(it.name ?? ""), t);
    const artists = (it.artists ?? []).map((x) => norm(x.name ?? ""));
    // アーティスト未記載の週（wikitext の揺れ）は曲名一致だけで採る。
    const artistOk = !a || artists.some((x) => loosely(x, a));
    if (titleOk && artistOk) {
      const cover = pickCover(it.album?.images);
      return { url: it.external_urls?.spotify ?? "", ...(cover ? { cover } : {}) };
    }
  }
  return { url: "" };
}

/** 曲を検索して {url, cover?} を返す。見つからなければ {url:""}。 */
async function searchTrack(w: ChartWeek): Promise<SpotifyEntry> {
  // track:"..." artist:"..." のフィールド指定は邦楽で取りこぼすので、フリーテキストで引いて結果側で照合する。
  const q = `${w.title} ${w.artist}`.trim();
  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&type=track&market=JP&limit=5`;
  const call = async (token: string): Promise<SearchResponse> =>
    fetchJson<SearchResponse>(url, { gate: false, retries: 3, headers: { Authorization: `Bearer ${token}` } });

  let data: SearchResponse;
  try {
    data = await call(await getToken());
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
    data = await call(await getToken(true)); // トークン期限切れ
  }
  return pickTrack(data.tracks?.items ?? [], w);
}

// 同じ曲が複数週・複数年で 1 位になるので、実行中の重複解決をまとめる。
// 値: {url, cover?} / {url:""}（無い） / null（取得失敗＝キャッシュしない）
const inflight = new Map<string, Promise<SpotifyEntry | null>>();
function resolveOnce(key: string, w: ChartWeek): Promise<SpotifyEntry | null> {
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      await acquire();
      try {
        return await searchTrack(w);
      } catch {
        return null; // ネットワーク/API エラーは負キャッシュにしない（次回また試す）
      } finally {
        release();
      }
    })();
    inflight.set(key, p);
  }
  return p;
}

/**
 * 未キャッシュの曲だけ Spotify に問い合わせ、week.spotify / week.cover を埋める（cache はその場で更新）。
 * SPOTIFY_RECHECK=1 で「見つからなかった」負キャッシュと、cover を持たない旧 string 値も引き直す。
 */
export async function attachSpotify(
  weeks: ChartWeek[],
  cache: Record<string, string | SpotifyEntry>,
  stats: SpotifyStats,
): Promise<void> {
  const creds = hasSpotifyCreds();
  const recheck = Boolean(process.env.SPOTIFY_RECHECK);
  await Promise.all(
    weeks.map(async (w) => {
      if (!w.title) return;
      const key = songKey(w);
      const raw = cache[key];
      let entry: SpotifyEntry | undefined = raw === undefined ? undefined : entryOf(raw);
      const stale = entry !== undefined && (entry.url === "" || typeof raw === "string");
      if (creds && (entry === undefined || (stale && recheck))) {
        const found = await resolveOnce(key, w);
        if (found === null) {
          stats.failed++;
          return; // 失敗した曲は spotify 未設定のまま＝表示側は検索 URL
        }
        cache[key] = found;
        if (found.url) stats.resolved++;
        else stats.missing++;
        entry = found;
      }
      if (entry?.url) w.spotify = entry.url;
      if (entry?.cover) w.cover = entry.cover;
    }),
  );
}
