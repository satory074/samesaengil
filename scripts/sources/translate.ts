// 英語プロフィールの日本語化（任意）。GEMINI_API_KEY が無ければ何もしない。
// Wikidata に descriptions.ja が無い人物のみ、英語 description をまとめて翻訳する。

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * 英語テキスト配列を日本語へ一括翻訳。
 * key が無い／失敗時は null 配列（呼び出し側で原文フォールバック）。
 */
export async function translateToJa(texts: string[]): Promise<(string | null)[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || texts.length === 0) return texts.map(() => null);

  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const prompt =
    "次の人物プロフィール（英語）を、それぞれ簡潔な日本語（体言止め・15文字以内目安）に翻訳してください。" +
    "番号と訳文だけを「番号. 訳文」の形式で1行ずつ、入力と同じ順・同じ件数で出力してください。\n\n" +
    numbered;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = (await res.json()) as GeminiResponse;
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const byIndex: (string | null)[] = texts.map(() => null);
    for (const line of out.split("\n")) {
      const m = /^\s*(\d+)\.\s*(.+)$/.exec(line);
      if (!m) continue;
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < texts.length) byIndex[idx] = m[2].trim();
    }
    return byIndex;
  } catch (e) {
    console.warn(`  [translate] スキップ: ${(e as Error).message}`);
    return texts.map(() => null);
  }
}
