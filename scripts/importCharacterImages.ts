// キャラの顔画像を AniList（認証不要）から作品単位で取得し、src/data/anilist.json に貯める取込スクリプト。
//
//   npm run import:char-images            … キャラ seed の全作品を人気順に処理（CHAR_IMG_WORKS 件まで）
//   npx tsx scripts/importCharacterImages.ts 銀魂 "NARUTO-ナルト-"   … 指定作品のみ（デバッグ）
//   CHAR_IMG_RECHECK=1 …                  … 「見つからなかった」負キャッシュも引き直す
//
// 設計:
// - キャラ名のグローバル検索はノイズが多い（実測: 無関係な人気キャラが返る）ので使わない。
//   **Media(search:作品名) → characters をページネーション**で取り、ローカルで名前照合する。
// - Media 照合は緩く（mediaTitleMatches）、キャラ名照合は正規化後の完全一致のみ（charMatch.ts）。
// - 取得済み作品はスキップ＝**再実行で続きから**。レートは ~28 req/分（AniList の degraded 制限 30 に合わせる）。
// - 反映は aggregate.ts の buildCharacterMap が anilist.json を読むだけ（実行時 API なし）。
//   取得後に `CHARS_ONLY=1 npm run aggregate` で全366日へ数秒で反映する。
import fs from "node:fs";
import path from "node:path";
import { fetchJson, sleep } from "./lib/util";
import { charNameMatches, mediaTitleMatches, normName, normWork, stripSeries, type CharNameNode } from "./lib/charMatch";
import { readState, resolveWorkFame } from "./lib/state";
import charactersSeed from "../src/data/characters.json";
import fanwebSeed from "../src/data/characters-fanweb.json";

const API = "https://graphql.anilist.co";
const OUT_PATH = path.join(process.cwd(), "src", "data", "anilist.json");

/** 1作品ぶんの取得結果。none は「AniList に見つからなかった」の負キャッシュ。 */
interface WorkEntry {
  title?: string;
  chars?: Record<string, string>;
  none?: true;
}
interface AnilistCache {
  works: Record<string, WorkEntry>;
}

type SeedRow = { name: string; work: string };

/** ~28 req/分のペーシング（AniList の 30 req/分制限に合わせる）。 */
let lastReq = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastReq + 2100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
  return fn();
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  return paced(() =>
    fetchJson<T>(API, {
      gate: false,
      retries: 4,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      method: "POST",
      body: JSON.stringify({ query, variables }),
    }),
  );
}

interface MediaSearchResp {
  data?: {
    Page?: {
      media?: {
        id: number;
        type?: string;
        title?: { native?: string | null; romaji?: string | null; english?: string | null };
        synonyms?: (string | null)[];
      }[];
    };
  };
}

interface CharsResp {
  data?: {
    Media?: {
      characters?: {
        pageInfo?: { hasNextPage?: boolean };
        nodes?: { name?: CharNameNode | null; image?: { medium?: string | null } | null }[];
      };
    };
  };
}

const MEDIA_QUERY = `query($q:String){Page(perPage:6){media(search:$q){id type title{native romaji english} synonyms}}}`;
const CHARS_QUERY = `query($id:Int,$p:Int){Media(id:$id){characters(page:$p,perPage:25){pageInfo{hasNextPage}nodes{name{native full alternative}image{medium}}}}}`;

/** 作品ごとのページ上限（銀魂級で500キャラ=20ページ。暴走防止）。 */
const MAX_PAGES = 20;

/**
 * 作品名 → マッチした Media（MANGA 優先で最大2件＝漫画版とアニメ版のキャラ集合の違いを吸収）。
 *
 * **タイトルの完全一致（正規化後）を包含一致より優先する。** 検索の並び順に頼ると
 * 「怪獣8号」でスピンオフ（怪獣8号 密着!第3部隊）、「ハイキュー!!」で番外編が
 * 本編より先に来ることがあり、本編のキャラ一覧を取り損ねる（実測）。
 */
async function findMedia(work: string): Promise<{ id: number; native: string }[]> {
  const resp = await gql<MediaSearchResp>(MEDIA_QUERY, { q: stripSeries(work) });
  const target = normWork(work);
  const cands = (resp.data?.Page?.media ?? [])
    .map((m) => {
      const titles = [m.title?.native, m.title?.romaji, m.title?.english, ...(m.synonyms ?? [])];
      const exact = titles.some((t) => normName(t ?? "") === target);
      return { m, exact, ok: exact || mediaTitleMatches(work, titles) };
    })
    .filter((c) => c.ok)
    .sort((a, b) => Number(b.exact) - Number(a.exact)); // 完全一致を先頭に（sort は安定）
  const manga = cands.filter((c) => c.m.type === "MANGA");
  const anime = cands.filter((c) => c.m.type === "ANIME");
  return [...manga.slice(0, 1), ...anime.slice(0, 1)].map(({ m }) => ({
    id: m.id,
    native: m.title?.native ?? m.title?.romaji ?? "",
  }));
}

/** Media の全キャラ（名前ノード＋画像URL）をページネーションで取る。 */
async function fetchAllChars(mediaId: number): Promise<{ name: CharNameNode; image: string }[]> {
  const out: { name: CharNameNode; image: string }[] = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const resp = await gql<CharsResp>(CHARS_QUERY, { id: mediaId, p });
    const c = resp.data?.Media?.characters;
    for (const n of c?.nodes ?? []) {
      if (n.name && n.image?.medium) out.push({ name: n.name, image: n.image.medium });
    }
    if (!c?.pageInfo?.hasNextPage) break;
  }
  return out;
}

function readCache(): AnilistCache {
  try {
    const c = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")) as AnilistCache;
    c.works ??= {};
    return c;
  } catch {
    return { works: {} };
  }
}

function writeCache(cache: AnilistCache): void {
  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 0) + "\n");
}

async function run(): Promise<void> {
  const argWorks = process.argv.slice(2).filter(Boolean);
  const recheck = Boolean(process.env.CHAR_IMG_RECHECK);
  const limit = Number(process.env.CHAR_IMG_WORKS ?? 800);

  // 作品ごとのキャラ名一覧（seed 2系統をマージ。照合のローカル側）。
  const byWork = new Map<string, Set<string>>();
  for (const c of [...(charactersSeed as SeedRow[]), ...(fanwebSeed as SeedRow[])]) {
    if (!c.work || !c.name) continue;
    const set = byWork.get(c.work) ?? new Set<string>();
    set.add(c.name);
    byWork.set(c.work, set);
  }

  // 処理順 = 作品の人気（表示の並びと同じ基準）降順。途中で止めても見える部分から埋まる。
  const state = readState();
  const fame = await resolveWorkFame([...byWork.keys()], state, true); // cacheOnly＝API を叩かない
  let targets = [...byWork.keys()].sort((a, b) => (fame.get(b) ?? 0) - (fame.get(a) ?? 0));
  if (argWorks.length > 0) targets = argWorks.filter((w) => byWork.has(w));

  const cache = readCache();
  // argv 指定はデバッグ/修復用なのでキャッシュ済みでも引き直す。通常運転は未取得のみ（再開可能）。
  const pending =
    argWorks.length > 0
      ? targets
      : targets.filter((w) => {
          const e = cache.works[w];
          if (e === undefined) return true;
          return Boolean(e.none && recheck);
        });
  const todo = argWorks.length > 0 ? pending : pending.slice(0, limit);
  console.log(
    `[char-images] 対象 ${targets.length} 作品（取得済み ${targets.length - pending.length} / 今回 ${todo.length}、上限 ${argWorks.length ? "なし" : limit}）`,
  );

  let done = 0;
  let matchedWorks = 0;
  let matchedChars = 0;
  let totalChars = 0;
  for (const work of todo) {
    const names = byWork.get(work)!;
    totalChars += names.size;
    try {
      const medias = await findMedia(work);
      if (medias.length === 0) {
        cache.works[work] = { none: true };
      } else {
        // 漫画版・アニメ版の両方からキャラを取ってマージ（先勝ち＝MANGA 優先）。
        const chars: Record<string, string> = {};
        const nodes: { name: CharNameNode; image: string }[] = [];
        for (const m of medias) nodes.push(...(await fetchAllChars(m.id)));
        for (const want of names) {
          if (chars[want]) continue;
          const hit = nodes.find((n) => charNameMatches(want, n.name));
          if (hit) chars[want] = hit.image;
        }
        const n = Object.keys(chars).length;
        cache.works[work] = n > 0 ? { title: medias[0].native, chars } : { none: true };
        if (n > 0) {
          matchedWorks++;
          matchedChars += n;
        }
        console.log(`  ${work}: ${medias.map((m) => m.native).join(" + ")} → キャラ照合 ${n}/${names.size}`);
      }
    } catch (e) {
      console.warn(`  ${work} ⚠ ${(e as Error).message}（キャッシュせず次回再試行）`);
    }
    done++;
    if (done % 10 === 0) {
      writeCache(cache); // 途中保存（長時間ランを落ちても再開できるように）
      console.log(`  …${done}/${todo.length}`);
    }
  }
  writeCache(cache);

  const totalWorks = Object.values(cache.works).filter((e) => !e.none).length;
  const totalImgs = Object.values(cache.works).reduce((a, e) => a + Object.keys(e.chars ?? {}).length, 0);
  console.log(
    `[char-images] 完了: 今回 ${matchedWorks} 作品・${matchedChars} キャラに画像 / 累計 ${totalWorks} 作品・${totalImgs} キャラ`,
  );
  console.log(`[char-images] 反映は: CHARS_ONLY=1 npm run aggregate`);
}

run().catch((e) => {
  console.error("[char-images] 致命的エラー:", e);
  process.exit(1);
});
