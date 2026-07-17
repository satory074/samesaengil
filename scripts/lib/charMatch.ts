// キャラ画像（AniList）の名寄せ純関数。作品名 → Media、キャラ名 → character の照合に使う。
//
// 設計: Media の照合は**緩く**（表記ゆれで取りこぼすと作品ごと全滅する。誤マッチしても
// 中のキャラ名が一致しなければ画像は付かない＝キャラ名照合が第二関門になる）、
// キャラ名の照合は**正規化後の完全一致のみ**（作品内の照合なのでグローバル検索と違い
// 誤爆源が少なく、厳密にしても取りこぼしが小さい）。
//
// tsx からテストされる（scripts/smoketest.ts）。DOM・API 非依存。

/** 名前の正規化: NFKC → 空白・中黒・記号ハイフン類・「=」を除去 → 英字小文字化。 */
export function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s・･=＝\-–—−‐ー~〜!！?？'’"”「」『』()（）\[\]］［.。,、]/g, "");
}

/**
 * 作品名を検索語に整える: normName ＋ 末尾の「シリーズ」を除去。
 * 「ストリートファイターシリーズ」→「すとりーとふぁいたー…」相当（検索は元の表記で行い、
 * 照合にこの正規化を使う）。検索語生成用には stripSeries を別途使う。
 */
export function normWork(s: string): string {
  return normName(stripSeries(s));
}

/** 検索語用: 末尾の「シリーズ」だけ落とす（表記はそのまま）。 */
export function stripSeries(s: string): string {
  return s.replace(/シリーズ$/u, "").trim();
}

/**
 * AniList Media のタイトル群（native/romaji/english/synonyms）が作品名と噛み合うか。
 * 正規化後に**片方がもう片方を含む**なら採用（「NARUTO -ナルト-」⊃「NARUTO-ナルト-」、
 * 「銀魂」＝「銀魂」）。3文字未満の包含は誤爆しやすいので完全一致のみ。
 */
export function mediaTitleMatches(work: string, titles: (string | null | undefined)[]): boolean {
  const w = normWork(work);
  if (!w) return false;
  for (const t of titles) {
    const n = normName(t ?? "");
    if (!n) continue;
    if (n === w) return true;
    if (w.length >= 3 && n.includes(w)) return true;
    if (n.length >= 3 && w.includes(n)) return true;
  }
  return false;
}

/** AniList character ノードの名前形（native＋別名）。 */
export interface CharNameNode {
  native?: string | null;
  full?: string | null;
  alternative?: (string | null)[] | null;
}

/** キャラ名が一致するか（正規化後の完全一致のみ。native → alternative → full の順に見る）。 */
export function charNameMatches(fanwebName: string, node: CharNameNode): boolean {
  const target = normName(fanwebName);
  if (!target) return false;
  const cands = [node.native, ...(node.alternative ?? []), node.full];
  for (const c of cands) {
    if (c && normName(c) === target) return true;
  }
  return false;
}
