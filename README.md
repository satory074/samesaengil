# samesaengil 🎂

生年月日を入れると「同じ誕生日のあれこれ」が出てくる、若者向け・飲み会ネタ用の静的サイト。
名前は **same 생일(saeng-il)** ＝「同じ誕生日」。

公開URL: https://satory074.github.io/samesaengil/

入力した生年月日（年も使う）から、その誕生日にまつわる情報をまとめて表示します。

- 🎤 **同じ誕生日の有名人**（顔写真つき・日本で有名な人を優先）
- 🦸 **同じ誕生日のキャラ**（ONE PIECE / 鬼滅 / 呪術 など複数作品）
- 📅 **今日は何の日**（記念日・できごと）
- ✨ **誕生日プロフィール**（年齢・干支・和暦世代・星座・誕生石・誕生花）
- 📣 **シェア**（`?d=YYYY-MM-DD` の共有URL ＋ Xシェア）

## 技術スタック

Astro 5 + Tailwind v4 + TypeScript、GitHub Pages（GitHub Actions デプロイ）。
`todayai` / `kisei` / `aishiritai` と同じ構成。

```bash
npm install
npm run dev        # http://localhost:4321/samesaengil/
npm run build      # dist/ に静的出力
npm run typecheck  # astro check
npm run test       # smoketest（暦・日付ロジック）+ domtest（jsdom）
npm run aggregate         # 全366日のデータ生成（Wikipedia/Wikidata/日本語版Wikipedia）
npm run aggregate 03-15   # 指定日だけ生成（デバッグ用）
```

## データの作られ方

`scripts/aggregate.ts` が 366 日ぶんを `public/data/days/MM-DD.json` に生成（コミット）。
クライアントは入力日の 1 ファイルだけ fetch し、暦の計算（星座・年齢など）はブラウザ側で行う。

| セクション | ソース | 取得方法 |
|---|---|---|
| 有名人＋顔写真 | 英語版 Wikipedia `onthisday/births` | REST フィード（Q-ID・写真・生年・英語プロフィール） |
| 日本語名・知名度 | Wikidata `wbgetentities` | Action API（SPARQLではない。日本語名／日本語説明／sitelink数／jawiki有無） |
| 今日は何の日 | 日本語版 Wikipedia「M月D日」 | Action API（記念日・年中行事／できごと節をパース） |
| キャラ | 手動JSON `src/data/characters.json` | 静的（名前・作品名のみ。**画像は著作権のため不掲載**） |
| 星座・誕生石・誕生花・干支・和暦 | `src/lib/almanac.ts` | 月日・年から計算（API不要） |

英語プロフィールの日本語化は任意（`GEMINI_API_KEY` があれば Gemini で翻訳。無ければ英語のまま）。
キャッシュ・失敗時フォールバックは `src/data/state.json` と前回の per-day ファイルで担保。

## キャラの追加（手動JSON）

`src/data/characters.json` に `{ name, work, month, day, color? }` を足すだけ。
公式設定の誕生日を、若者が知っている作品を中心に拡張していく想定（`lastcall` と同じ手動運用）。

## 著作権・クレジット

- 有名人の顔写真は Wikimedia Commons（自由ライセンス）から直リンク。各カードは出典記事へリンク。
- フィクションキャラは**画像を掲載せず**、名前と作品名のみ（ONE PIECE も他作品も同じ扱い）。

## ライセンス / 注意

誕生日を知るための非公式・趣味サイト。データは各出典に帰属。
