// ゲームのジャケット画像を IGDB（Twitch）で解決する。
//
// 資格情報（IGDB_CLIENT_ID / IGDB_CLIENT_SECRET）が無ければ解決はスキップし、キャッシュ済みの
// 分だけ埋める＝表示側は Steam 由来のジャケか 🎮 プレースホルダにフォールバックする。
// 解決結果は src/data/igdb.json（"jawiki記事タイトル" -> {id}、{id:""} は負キャッシュ）。
//
// **主経路は Wikidata 橋渡しで、IGDB の検索は使わない**——IGDB の search は
// **日本語クエリに 0 件しか返さない**（『呪術廻戦』『鬼滅の刃 目指せ!最強隊士!』等で実測）。
// 代わりに jawiki記事 → Q-ID（state.pages にキャッシュ済み）→ Wikidata の IGDB ID(P5794)
// → IGDB の slug 一括引き、と辿る。Wikidata の ID は人手で紐づけられているので**照合が不要**で、
// 全段 50件バッチ＝数分で全件処理できる（Q-ID を持つ記事の 63% に P5794 があると実測）。
// ラテン文字名だけは search も効くので、Wikidata で引けなかったぶんの保険に残してある。
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
  /** キャッシュのキー＝jawiki 記事タイトル（主経路の Wikidata 橋渡しと同じ単位に揃える）。 */
  key: string;
  /** 検索語（ゲーム名）。 */
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

/** 発売年の許容差。IGDB の first_release_date は世界初出で、日本版とずれることがある。 */
const YEAR_SLACK = 1;

/** IGDB の候補から採るものを選ぶ純関数（smoketest 対象）。 */
export function pickCover(games: IgdbGame[], target: CoverTarget): IgdbEntry {
  const want = normalizeTitle(target.name);
  const namesOf = (g: IgdbGame): string[] =>
    [g.name ?? "", ...(g.alternative_names ?? []).map((a) => a.name ?? "")].filter(Boolean);
  const yearOf = (g: IgdbGame): number | null =>
    g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;

  const withCover = games.filter((g) => g.cover?.image_id);
  const nearYear = (g: IgdbGame): boolean => {
    const y = yearOf(g);
    return y !== null && Math.abs(y - target.year) <= YEAR_SLACK;
  };
  const exact = withCover.filter((g) => namesOf(g).some((n) => normalizeTitle(n) === want));
  const loose = withCover.filter((g) => namesOf(g).some((n) => titlesMatch(n, target.name)));

  // 名前の一致度 × 発売年の裏取り、の順に降りていく。名前だけで先頭を採ると続編や別名義に
  // 当たる（steamStore で『Slay the Spire』に続編が当たった実例）ので、年で corroborate できる
  // 候補を優先する。最後の段が要——**日本語名と英題は文字種が違って照合できない**が
  // （『メタルギアソリッド3』と "Metal Gear Solid 3: Snake Eater"）、IGDB の検索順は信頼できるので、
  // 発売年が合う先頭候補なら採る。これが無いとヒット率は 20% に落ちる（実測）。
  const hit =
    exact.find(nearYear) ?? exact[0] ?? loose.find(nearYear) ?? withCover.find(nearYear) ?? loose[0];
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
      cache[t.key] = entry;
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

// ---- 主経路: Wikidata 橋渡し（jawiki記事 → Q-ID → IGDB ID → ジャケ）----

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

interface WbEntities {
  entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>;
}

/** Q-ID → IGDB の slug（P5794）。Wikidata に無いものは Map に入らない。50件バッチ。 */
export async function fetchIgdbSlugs(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 50) {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: qids.slice(i, i + 50).join("|"),
      props: "claims",
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    try {
      const data = await fetchJson<WbEntities>(`${WIKIDATA_API}?${params.toString()}`);
      for (const [qid, e] of Object.entries(data.entities ?? {})) {
        const v = e.claims?.P5794?.[0]?.mainsnak?.datavalue?.value;
        if (typeof v === "string" && v) out.set(qid, v);
      }
    } catch {
      // 取れなかったバッチは次回に回す（負キャッシュにしない）
    }
  }
  return out;
}

/** IGDB の slug → cover image_id。50件バッチ・照合不要（Wikidata が紐づけ済み）。 */
export async function fetchCoversBySlug(slugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < slugs.length; i += 50) {
    const batch = slugs.slice(i, i + 50);
    const quoted = batch.map((s) => `"${quote(s)}"`).join(",");
    const body = `fields slug,cover.image_id; where slug = (${quoted}); limit 50;`;
    const call = async (token: string): Promise<{ slug?: string; cover?: { image_id?: string } }[]> =>
      fetchJson(API_URL, {
        gate: false,
        retries: 3,
        max429WaitMs: MAX_429_WAIT_MS,
        method: "POST",
        body,
        headers: { "Client-ID": process.env.IGDB_CLIENT_ID ?? "", Authorization: `Bearer ${token}` },
      });
    try {
      await pace();
      let games;
      try {
        games = await call(await getToken());
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 401) throw e;
        games = await call(await getToken(true));
      }
      for (const g of games ?? []) {
        if (g.slug && g.cover?.image_id) out.set(g.slug, g.cover.image_id);
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        banned = true;
        console.warn("[covers] 429（レート上限）を検知。この実行では以降をスキップします（次回再試行）");
        break;
      }
    }
  }
  return out;
}
