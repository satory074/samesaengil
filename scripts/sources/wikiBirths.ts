// 英語版 Wikipedia の onthisday/births フィードから「その月日に生まれた人」を取得。
// 各エントリは Wikidata Q-ID・サムネ顔写真・英語プロフィール・生年を持つ。
import { fetchJson } from "../lib/util";

export interface RawPerson {
  qid: string;
  nameEn: string;
  year: number;
  descEn: string;
  photo: string;
  url: string;
}

interface BirthsResponse {
  births?: {
    year?: number;
    pages?: {
      normalizedtitle?: string;
      title?: string;
      description?: string;
      thumbnail?: { source?: string };
      wikibase_item?: string;
      content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } };
    }[];
  }[];
}

/** month, day（1始まり）の誕生人物リストを取得。Q-ID を持つもののみ。 */
export async function fetchBirths(month: number, day: number): Promise<RawPerson[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/${month}/${day}`;
  const data = await fetchJson<BirthsResponse>(url);
  const out: RawPerson[] = [];
  for (const b of data.births ?? []) {
    const pg = b.pages?.[0];
    if (!pg || !pg.wikibase_item || !b.year) continue;
    out.push({
      qid: pg.wikibase_item,
      nameEn: pg.normalizedtitle ?? pg.title ?? "",
      year: b.year,
      descEn: pg.description ?? "",
      photo: pg.thumbnail?.source ?? "",
      url: pg.content_urls?.desktop?.page ?? "",
    });
  }
  // 同一人物が複数年エントリで重複することは基本ないが、念のため qid で一意化。
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.qid) ? false : (seen.add(p.qid), true)));
}
