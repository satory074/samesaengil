// 顔写真のフォールバック。日本語版 Wikipedia の pageimages で写真が取れなかった人物だけを対象にする。
// 認証不要（Wikimedia のみ）。
//
// なぜ必要か: 日本語版 Wikipedia は非自由画像を認めないため、**存命の日本の俳優・タレント**には
// 代表画像が無い記事が多い（写真なしの 97% がこれ。レート制限の取りこぼしではない）。
// その層こそ閲覧数（fame）が高くカード一覧の先頭に来るので、一覧の見た目を最も損なう。
//
// ただし無認証で埋められるのは実測で写真なし層の ~9% だけ（＝Wikimedia に自由ライセンス写真が
// 存在する人の割合そのもの）。残りは原理的に埋まらないので、表示側でプレースホルダを整えて補う。
//
// カスケード（先に当たったものを採用）:
//   1. Wikidata P18       … すでに state.pages に貯まっている Q-ID をそのまま使う
//   2. Commons SDC depicts … 既定オフ（PHOTO_COMMONS=1）。1人1コールで重い割に P18 と重複する
import { chunk, fetchJson, mapLimit } from "../lib/util";
import { looksLikePortrait, p18FileMatchesPerson } from "../lib/portrait";

export type PhotoSrc = "p18" | "commons";

export interface PhotoHit {
  url: string;
  src: PhotoSrc;
}

/** 写真を探す対象。key は state.photos / state.pages のキー（jawiki の要求タイトル）。 */
export interface PhotoCandidate {
  key: string;
  name: string;
  /** Wikidata Q-ID（state.pages に既にあるもの）。無ければ P18/depicts はスキップ。 */
  qid?: string;
}

/** ソース別の解決数。サイレント破損の検知用（既存ソースと同じ規範）。 */
export interface PhotoStats {
  p18: number;
  commons: number;
  missing: number;
  failed: number;
}

export function emptyPhotoStats(): PhotoStats {
  return { p18: 0, commons: 0, missing: 0, failed: 0 };
}

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/* ---------------- 1. Wikidata P18 ---------------- */

interface WbGetEntitiesResponse {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value?: string }>;
      aliases?: Record<string, { value?: string }[]>;
      claims?: {
        P18?: { mainsnak?: { datavalue?: { value?: string } } }[];
      };
    }
  >;
}

/** P18 の候補（ファイル名と、その人物の名前の表記ゆれ）。ラベル・別名は同じ 1 コールで取れる。 */
interface P18Candidate {
  file: string;
  /** 日本語表記（ラベル＋別名）。ファイル名に含まれていれば本人と判断する。 */
  ja: string[];
  /** ローマ字表記（ラベル＋別名）。"Hikaru Tōno" / "Tono Hikaru" のような揺れを別名が吸収してくれる。 */
  en: string[];
}

/** Q-ID 群 → P18 のファイル名＋名前の表記ゆれ（50件バッチ）。顔写真らしくないファイル名はここで捨てる。 */
async function fetchP18(qids: string[]): Promise<Map<string, P18Candidate>> {
  const out = new Map<string, P18Candidate>();
  const uniq = [...new Set(qids.filter(Boolean))];
  if (uniq.length === 0) return out;

  await mapLimit(chunk(uniq, 50), 2, async (batch) => {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "claims|labels|aliases",
      languages: "ja|en",
      format: "json",
    });
    const data = await fetchJson<WbGetEntitiesResponse>(`${WIKIDATA_API}?${params}`);
    const values = (v: { value?: string }[] | undefined): string[] =>
      (v ?? []).map((x) => x.value ?? "").filter(Boolean);
    for (const [qid, e] of Object.entries(data.entities ?? {})) {
      const file = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (!file || !looksLikePortrait(file)) continue;
      out.set(qid, {
        file,
        ja: [e.labels?.ja?.value ?? "", ...values(e.aliases?.ja)].filter(Boolean),
        en: [e.labels?.en?.value ?? "", ...values(e.aliases?.en)].filter(Boolean),
      });
    }
  });
  return out;
}

interface CommonsImageInfoResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: Record<string, { title?: string; missing?: string; imageinfo?: { thumburl?: string }[] }>;
  };
}

/**
 * Commons のファイル名群 → 320px のサムネ URL（50件バッチ）。
 * Special:FilePath のリダイレクトをブラウザに踏ませず、既存写真と同じ upload.wikimedia.org の直リンクに揃える。
 */
async function fetchCommonsThumbs(files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(files.filter(Boolean))];
  if (uniq.length === 0) return out;

  await mapLimit(chunk(uniq, 50), 2, async (batch) => {
    const params = new URLSearchParams({
      action: "query",
      titles: batch.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "320",
      format: "json",
    });
    const data = await fetchJson<CommonsImageInfoResponse>(`${COMMONS_API}?${params}`);
    // normalized（アンダースコア→空白など）を辿って、要求したファイル名で引けるようにする。
    const canon = new Map<string, string>(); // 正規化後タイトル -> 要求ファイル名
    for (const f of batch) canon.set(`File:${f}`, f);
    for (const n of data.query?.normalized ?? []) {
      const orig = canon.get(n.from);
      if (orig) canon.set(n.to, orig);
    }
    for (const p of Object.values(data.query?.pages ?? {})) {
      if (p.missing !== undefined || !p.title) continue;
      const thumb = p.imageinfo?.[0]?.thumburl;
      const orig = canon.get(p.title);
      if (thumb && orig) out.set(orig, thumb);
    }
  });
  return out;
}

/* ---------------- 2. Commons SDC depicts ---------------- */

interface CommonsSearchResponse {
  query?: {
    pages?: Record<string, { title?: string; imageinfo?: { thumburl?: string }[] }>;
  };
}

/**
 * 「この人物が写っている」と構造化データ（P180 depicts）が言うファイル。P18 が無い人の保険。
 * depicts も「写っている」であって「顔写真」ではない（今田美桜の建物写真も depicts では出てくる）ので、
 * P18 と同じくファイル名に本人の名前を要求する。
 */
async function fetchDepicts(c: PhotoCandidate): Promise<PhotoHit | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `haswbstatement:P180=${c.qid}`,
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "320",
  });
  const data = await fetchJson<CommonsSearchResponse>(`${COMMONS_API}?${params}`);
  for (const p of Object.values(data.query?.pages ?? {})) {
    const name = (p.title ?? "").replace(/^File:/, "");
    const thumb = p.imageinfo?.[0]?.thumburl;
    if (thumb && looksLikePortrait(name) && p18FileMatchesPerson(name, [c.name], [])) {
      return { url: thumb, src: "commons" };
    }
  }
  return null;
}

/* ---------------- カスケード本体 ---------------- */

/**
 * 候補群の顔写真を解決する。返るのは見つかった人だけ（key -> PhotoHit）。
 * 見つからなかった人は stats.missing に数える（呼び出し側が負キャッシュにする）。
 * 取得に失敗した人（ネットワーク/API エラー）は stats.failed に数え、**返り値にもキャッシュにも入れない**
 * ＝次回また試す（spotify.ts の負キャッシュ方針と同じ）。
 */
export async function resolvePhotos(
  cands: PhotoCandidate[],
  stats: PhotoStats,
): Promise<{ hits: Map<string, PhotoHit>; missing: string[] }> {
  const hits = new Map<string, PhotoHit>();
  const missing: string[] = [];
  if (cands.length === 0) return { hits, missing };

  // 取得に失敗した（＝「無い」と確定していない）人。負キャッシュにせず次回また試す。
  // 1 つの段が落ちても後続の段は試すので、ここに入っていても最終的に写真が見つかることはある。
  const failed = new Set<string>();

  // --- 1. Wikidata P18（Q-ID をバッチで引く）---
  let rest = cands;
  const withQid = rest.filter((c) => c.qid);
  if (withQid.length > 0) {
    try {
      const p18 = await fetchP18(withQid.map((c) => c.qid!));
      // ファイル名が本人の名前を含むものだけ採る（P18 は顔写真とは限らないため。lib/portrait.ts 参照）。
      const accepted = new Map<string, string>(); // key -> ファイル名
      for (const c of rest) {
        const cand = c.qid ? p18.get(c.qid) : undefined;
        if (cand && p18FileMatchesPerson(cand.file, [c.name, ...cand.ja], cand.en)) accepted.set(c.key, cand.file);
      }
      const thumbs = await fetchCommonsThumbs([...accepted.values()]);
      const remaining: PhotoCandidate[] = [];
      for (const c of rest) {
        const file = accepted.get(c.key);
        const url = file ? thumbs.get(file) : undefined;
        if (url) {
          hits.set(c.key, { url, src: "p18" });
          stats.p18++;
        } else {
          remaining.push(c);
        }
      }
      rest = remaining;
    } catch {
      for (const c of withQid) failed.add(c.key); // バッチごと落ちた＝この段は諦めて次へ
    }
  }

  // --- 2. Commons SDC depicts（既定オフ）---
  // 「この人物が写っている」と構造化データが言うファイル。精度は高いが **1人1コール**（バッチ不可）で、
  // Wikimedia のグローバルゲート越しに数万人ぶん走らせると1時間規模になる。実測では P18 とほぼ同じ
  // ファイルしか返さず上乗せが小さいため、既定では走らせない。PHOTO_COMMONS=1 で有効化。
  if (process.env.PHOTO_COMMONS) {
    const remaining: PhotoCandidate[] = [];
    await mapLimit(rest, 2, async (c) => {
      if (!c.qid) {
        remaining.push(c);
        return;
      }
      try {
        const hit = await fetchDepicts(c);
        if (hit) {
          hits.set(c.key, hit);
          stats.commons++;
          return;
        }
      } catch {
        failed.add(c.key);
      }
      remaining.push(c);
    });
    rest = remaining;
  }

  for (const c of rest) {
    if (failed.has(c.key)) {
      stats.failed++;
      continue; // 失敗した人は負キャッシュにしない（次回また試す）
    }
    missing.push(c.key);
    stats.missing++;
  }
  return { hits, missing };
}
