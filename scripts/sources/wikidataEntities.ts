// Wikidata Action API（wbgetentities, SPARQL ではない）で Q-ID を一括補完。
// 日本語名・日本語プロフィール・知名度(sitelink 数)・日本での知名度(jawiki 有無) を返す。
import { chunk, fetchJson, mapLimit } from "../lib/util";

export interface Enriched {
  nameJa?: string;
  descJa?: string;
  fame: number; // sitelink 数
  jaKnown: boolean; // jawiki に記事があるか
}

interface WbResponse {
  entities?: Record<
    string,
    {
      missing?: string;
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
      sitelinks?: Record<string, unknown>;
    }
  >;
}

/** Q-ID 群を 50 件ずつのバッチに分け、最大3並列で取得して Map に詰める。 */
export async function fetchEntities(qids: string[]): Promise<Map<string, Enriched>> {
  const map = new Map<string, Enriched>();
  const batches = chunk(qids, 50);
  await mapLimit(batches, 3, async (batch) => {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: batch.join("|"),
      props: "labels|descriptions|sitelinks",
      languages: "ja|en",
      format: "json",
      origin: "*",
    });
    const url = `https://www.wikidata.org/w/api.php?${params.toString()}`;
    const data = await fetchJson<WbResponse>(url);
    for (const [qid, e] of Object.entries(data.entities ?? {})) {
      if (e.missing !== undefined) {
        map.set(qid, { fame: 0, jaKnown: false });
        continue;
      }
      const sitelinks = e.sitelinks ?? {};
      map.set(qid, {
        nameJa: e.labels?.ja?.value,
        descJa: e.descriptions?.ja?.value,
        fame: Object.keys(sitelinks).length,
        jaKnown: "jawiki" in sitelinks,
      });
    }
  });
  return map;
}
