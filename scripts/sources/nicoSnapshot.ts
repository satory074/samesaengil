// ニコニコ動画「スナップショット検索API v2」からミリオン（100万再生以上）達成動画を引く。
//
// キー不要・キーワードなし検索（q= 空）に対応していて、filters[viewCounter][gte]=1000000 で
// 全ジャンル横断の「ミリオン動画」がそのまま取れる（2026-09 時点で全 7,161 本）。
// ここでは「その年に投稿されたミリオン動画を全件」返すだけで、月日ごとのバケツ分けは
// aggregate 側（buildNicoMap）で行う。
//
// 設計は sources/steamStore.ts を踏襲する:
//   ・別ホストなので Wikipedia 用のグローバルゲートは通さない（gate:false）。代わりに
//     モジュールレベルの開始間隔（paced）で絞る＝規約の「間隔を空けて」に沿う
//   ・429 を一度でも観測したらその実行は以降スキップ（サーキットブレーカー）
//   ・失敗した年は呼び出し側で前回値にフォールバック（空上書きしない）
//
// 規約メモ: 非営利利用のみ／User-Agent にサービス名（lib/util.ts の USER_AGENT が該当）。
import { HttpError, fetchJson, sleep } from "../lib/util";

const ENDPOINT = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search";
/** ミリオンの定義（再生数の下限）。 */
export const MILLION = 1_000_000;
/** 1 リクエストあたりの最大件数（API 上限）。 */
const PAGE = 100;

/** nicovideos.json の 1 行（1 動画 1 行）。 */
export interface NicoSeed {
  /** "sm9" / "so30413239" / "nm..." 。watch URL とサムネ URL の素。 */
  id: string;
  title: string;
  year: number;
  month: number;
  day: number;
  /** 再生数（万単位・切り捨て）。100 = 100万再生。生値を持たないのは types.ts の NicoVideo 参照。 */
  man: number;
  /** サムネのトークン。既定形（id の数字部）と違うときだけ持つ。 */
  thumb?: string;
}

export interface NicoStats {
  /** 取得できた動画の本数。 */
  fetched: number;
  /** 送信したリクエスト数。 */
  requests: number;
}

export function emptyNicoStats(): NicoStats {
  return { fetched: 0, requests: 0 };
}

/**
 * "2009-10-27T03:13:22+09:00" → { year:2009, month:10, day:27 }。
 * **Date に通さない**——startTime は JST（+09:00）なので、UTC ランナー（GitHub Actions）で
 * Date に通すと 00:00〜09:00 JST 投稿ぶん（全体の約12%）が前日にズレる。文字列から切り出す。
 */
export function ymdOfStartTime(startTime: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(startTime ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day || month > 12 || day > 31) return null;
  return { year, month, day };
}

/** id の数字部（"sm8628149" → "8628149"）。 */
function idNumberOf(id: string): string {
  return id.replace(/^[a-z]+/i, "");
}

/**
 * thumbnailUrl → 保存するトークン。既定形（.../{num}/{num}）なら undefined を返して省略する。
 * 旧形式 `.../8628149/8628149` と新形式 `.../43708803/43708803.68284955` の 2 系統があり、
 * 新形式はサフィックスを落とすと 404 になるので導出できない。so 系はディレクトリ番号が
 * contentId と一致しないことがあるが、ファイル名側がディレクトリ番号を含むので
 * トークン（＝ファイル名）だけ持てば URL を復元できる（nicoThumbUrl 参照）。
 */
export function thumbTokenOf(contentId: string, thumbnailUrl: string): string | undefined {
  const m = /\/thumbnails\/(\d+)\/([^/?#]+)/.exec(thumbnailUrl ?? "");
  if (!m) return undefined;
  const token = m[2];
  return token === idNumberOf(contentId) ? undefined : token;
}

// --- レート調停 ---------------------------------------------------------------
// ゲート外（別ホスト）なのでここで開始間隔を作る。同時実行は 1 固定（規約の「前回の
// レスポンス時間ぶんは間隔を空ける」に沿う。全部で ~90 リクエストなので急ぐ必要もない）。
const MIN_GAP_MS = Number(process.env.NICO_MIN_GAP_MS ?? 1200);
let nextAt = 0;
let banned = false;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const start = Math.max(now, nextAt);
  nextAt = start + MIN_GAP_MS;
  if (start > now) await sleep(start - now);
  return fn();
}

/** この実行で 429 を観測したか（観測後は残りの年をスキップする）。 */
export function nicoBanned(): boolean {
  return banned;
}

interface SnapshotItem {
  contentId?: string;
  title?: string;
  startTime?: string;
  viewCounter?: number;
  thumbnailUrl?: string;
}
interface SnapshotResponse {
  meta?: { status?: number; totalCount?: number };
  data?: SnapshotItem[];
}

function pageUrl(year: number, offset: number): string {
  // q= は空（キーワードなし検索）。_sort は必須で、投稿日時の昇順＝不変キーにする
  // （-viewCounter だと取得中に順位が動いてページ境界で取りこぼす）。
  const params = new URLSearchParams({
    q: "",
    targets: "title",
    fields: "contentId,title,startTime,viewCounter,thumbnailUrl",
    "filters[viewCounter][gte]": String(MILLION),
    "filters[startTime][gte]": `${year}-01-01T00:00:00+09:00`,
    "filters[startTime][lt]": `${year + 1}-01-01T00:00:00+09:00`,
    _sort: "+startTime",
    _limit: String(PAGE),
    _offset: String(offset),
    _context: "samesaengil",
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/** 1 件ぶんの変換。必須項目が欠けていれば null。 */
function toSeed(item: SnapshotItem): NicoSeed | null {
  const id = item.contentId ?? "";
  const title = item.title ?? "";
  const views = item.viewCounter ?? 0;
  const ymd = ymdOfStartTime(item.startTime ?? "");
  if (!id || !title || !ymd || views < MILLION) return null;
  const thumb = thumbTokenOf(id, item.thumbnailUrl ?? "");
  return {
    id,
    title,
    year: ymd.year,
    month: ymd.month,
    day: ymd.day,
    man: Math.floor(views / 10000),
    ...(thumb ? { thumb } : {}),
  };
}

/**
 * その年に投稿されたミリオン動画を全件取得する（_offset を 100 ずつ進める）。
 * totalCount に大きく届かなければ throw（＝呼び出し側が前回値にフォールバックする）。
 * ページングの途中で新たにミリオンを達成した動画が挿入されると ±数件ズレうるので、
 * id で重複排除したうえで許容差 2 件まで認める。
 */
export async function fetchMillionVideosOfYear(year: number, stats: NicoStats): Promise<NicoSeed[]> {
  const seeds = new Map<string, NicoSeed>();
  let received = 0;
  let total = -1;

  for (let offset = 0; ; offset += PAGE) {
    if (banned) throw new Error("429 を観測済みのためスキップ");
    let res: SnapshotResponse;
    try {
      res = await paced(() =>
        fetchJson<SnapshotResponse>(pageUrl(year, offset), { gate: false, retries: 2, max429WaitMs: 60_000 }),
      );
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        banned = true;
        console.warn("[nico] 429 を観測したのでこの実行の残りはスキップします（次回に持ち越し）");
      }
      throw e;
    }
    stats.requests++;
    if (total < 0) total = res.meta?.totalCount ?? -1;
    const items = res.data ?? [];
    received += items.length;
    for (const item of items) {
      const seed = toSeed(item);
      if (seed) seeds.set(seed.id, seed);
    }
    if (items.length < PAGE) break;
    if (offset + PAGE >= (total < 0 ? 0 : total)) break;
  }

  if (total < 0) throw new Error(`${year}年: totalCount が返りませんでした`);
  if (received < total - 2) {
    throw new Error(`${year}年: ${received}件しか取れませんでした（totalCount ${total}）`);
  }
  stats.fetched += seeds.size;
  return [...seeds.values()];
}
