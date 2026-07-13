// オリコン週間1位の曲を Spotify の曲ページに解決する（Client Credentials フロー）。
//
// 資格情報（SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET）が無ければ解決はスキップし、
// キャッシュ済みの分だけ埋める＝表示側は検索 URL にフォールバックする（他ソースと同じ graceful degradation）。
// 解決結果は src/data/spotify.json（"曲名|アーティスト" -> URL、"" は「Spotify に無い」の負キャッシュ）。
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

interface SearchResponse {
  tracks?: {
    items?: { name?: string; external_urls?: { spotify?: string }; artists?: { name?: string }[] }[];
  };
}

/** 照合用の正規化（全角/半角・大小・記号・空白の揺れを吸収）。 */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s'’"“”`・･,、.。!！?？&＆~〜\-–—_/\\()（）[\]［］{}【】「」]/g, "");
}

/** 短すぎる部分一致での誤爆を避けつつ、表記揺れ（〜Ver. 等）を許容する。 */
function loosely(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
}

/** 検索結果から曲を選ぶ。合致なしは ""（Spotify に無い＝負キャッシュ）。 */
function pickTrack(items: NonNullable<NonNullable<SearchResponse["tracks"]>["items"]>, w: ChartWeek): string {
  const t = norm(w.title);
  const a = norm(w.artist);
  for (const it of items) {
    const titleOk = loosely(norm(it.name ?? ""), t);
    const artists = (it.artists ?? []).map((x) => norm(x.name ?? ""));
    // アーティスト未記載の週（wikitext の揺れ）は曲名一致だけで採る。
    const artistOk = !a || artists.some((x) => loosely(x, a));
    if (titleOk && artistOk) return it.external_urls?.spotify ?? "";
  }
  return "";
}

/** 曲を検索して曲ページ URL を返す。見つからなければ ""。 */
async function searchTrack(w: ChartWeek): Promise<string> {
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
// 値: URL / ""（無い） / null（取得失敗＝キャッシュしない）
const inflight = new Map<string, Promise<string | null>>();
function resolveOnce(key: string, w: ChartWeek): Promise<string | null> {
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
 * 未キャッシュの曲だけ Spotify に問い合わせ、week.spotify を埋める（cache はその場で更新）。
 * SPOTIFY_RECHECK=1 で「見つからなかった」負キャッシュも引き直す。
 */
export async function attachSpotify(
  weeks: ChartWeek[],
  cache: Record<string, string>,
  stats: SpotifyStats,
): Promise<void> {
  const creds = hasSpotifyCreds();
  const recheck = Boolean(process.env.SPOTIFY_RECHECK);
  await Promise.all(
    weeks.map(async (w) => {
      if (!w.title) return;
      const key = songKey(w);
      let url: string | undefined = cache[key];
      if (creds && (url === undefined || (url === "" && recheck))) {
        const found = await resolveOnce(key, w);
        if (found === null) {
          stats.failed++;
          return; // 失敗した曲は spotify 未設定のまま＝表示側は検索 URL
        }
        cache[key] = found;
        if (found) stats.resolved++;
        else stats.missing++;
        url = found;
      }
      if (url) w.spotify = url;
    }),
  );
}
