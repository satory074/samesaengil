// 記念日 2 ソース（Wikipedia の年中行事 / 日本記念日協会の認定記念日）の表示時マージ。
// per-day JSON には別キー（anniversaries / kinenbi）で持ち、焼き込まない——マージ済みを
// 保存すると KINENBI_ONLY 再実行時に由来の判別が要り冪等でなくなるため。純関数（テスト対象）。
import type { Anniversary } from "./types";

/** 重複判定用の正規化。保守的に留める（NFKC＋小文字化＋全半角空白の除去のみ）。 */
export function normalizeAnnivLabel(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s　]+/g, "");
}

/**
 * Wikipedia を先頭に、日本記念日協会（kinenbi）を後置してマージ。
 * 同名（正規化一致）は Wikipedia のラベル位置・表記を保ったまま kinenbi の URL に昇格し、
 * kinenbi 側からは取り除く（二重表示しない）。祝日・年中行事など認知度の高い方が先に出る。
 */
export function mergeAnniversaries(wiki: Anniversary[], kinenbi: Anniversary[]): Anniversary[] {
  const byLabel = new Map<string, Anniversary>();
  for (const k of kinenbi) {
    const key = normalizeAnnivLabel(k.label);
    if (!byLabel.has(key)) byLabel.set(key, k); // 先勝ち
  }
  const used = new Set<Anniversary>();
  const head = wiki.map((w) => {
    const k = byLabel.get(normalizeAnnivLabel(w.label));
    if (!k || used.has(k)) return w;
    used.add(k);
    const desc = w.desc ?? k.desc;
    return { label: w.label, ...(desc ? { desc } : {}), ...(k.url ? { url: k.url } : {}) };
  });
  return [...head, ...kinenbi.filter((k) => !used.has(k))];
}
