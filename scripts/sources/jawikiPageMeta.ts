// 日本語版 Wikipedia のタイトル群を Wikidata Q-ID と顔写真サムネに一括解決。
// action=query の prop=pageimages|pageprops で 50 件ずつ・3 並列。
// normalized / redirects を辿って「要求タイトル」で引けるよう対応づける。
import { chunk, fetchJson, mapLimit } from "../lib/util";

export interface PageMeta {
  qid?: string;
  photo?: string;
  /** リダイレクト/正規化後の実記事タイトル（pageviews API の精度に必要）。 */
  title?: string;
}

interface QueryResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: Record<
      string,
      {
        title?: string;
        pageprops?: { wikibase_item?: string };
        thumbnail?: { source?: string };
      }
    >;
  };
  continue?: Record<string, string>;
}

const API = "https://ja.wikipedia.org/w/api.php";

/** 1 バッチ（最大 50 タイトル）を解決。pageimages の continue を辿る。 */
async function fetchBatch(titles: string[]): Promise<Map<string, PageMeta>> {
  const norm = new Map<string, string>(); // 正規化前 -> 正規化後
  const redir = new Map<string, string>(); // リダイレクト元 -> 先
  const byTitle = new Map<string, PageMeta>(); // 最終タイトル -> meta

  let cont: Record<string, string> | undefined;
  do {
    const params = new URLSearchParams({
      action: "query",
      prop: "pageimages|pageprops",
      ppprop: "wikibase_item",
      piprop: "thumbnail",
      pithumbsize: "320",
      format: "json",
      redirects: "1",
      titles: titles.join("|"),
      ...(cont ?? {}),
    });
    const data = await fetchJson<QueryResponse>(`${API}?${params.toString()}`);
    for (const n of data.query?.normalized ?? []) norm.set(n.from, n.to);
    for (const r of data.query?.redirects ?? []) redir.set(r.from, r.to);
    for (const p of Object.values(data.query?.pages ?? {})) {
      if (!p.title) continue;
      const prev = byTitle.get(p.title) ?? {};
      byTitle.set(p.title, {
        qid: p.pageprops?.wikibase_item ?? prev.qid,
        photo: p.thumbnail?.source ?? prev.photo,
        title: p.title, // 正規化後タイトル
      });
    }
    cont = data.continue;
  } while (cont);

  const out = new Map<string, PageMeta>();
  for (const t of titles) {
    const t1 = norm.get(t) ?? t;
    const t2 = redir.get(t1) ?? t1;
    const meta = byTitle.get(t2);
    if (meta) out.set(t, meta);
  }
  return out;
}

/** タイトル群 → Map<title, {qid, photo}>。重複除去・50 件バッチ・3 並列。 */
export async function fetchPageMeta(titles: string[]): Promise<Map<string, PageMeta>> {
  const uniq = [...new Set(titles.filter(Boolean))];
  const map = new Map<string, PageMeta>();
  if (uniq.length === 0) return map;
  await mapLimit(chunk(uniq, 50), 3, async (batch) => {
    const m = await fetchBatch(batch);
    for (const [k, v] of m) map.set(k, v);
  });
  return map;
}
