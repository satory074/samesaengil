# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

生年月日を入れると、その誕生日にまつわる情報（同じ誕生日の有名人＝顔写真つき・フィクションキャラ・記念日・星座/誕生石/誕生花/年齢/干支/和暦）が出てくる若者向け静的サイト。Astro 5 + Tailwind v4 + TypeScript、GitHub Pages（Actions デプロイ）。公開: https://satory074.github.io/samesaengil/

## Commands

```bash
npm run dev          # 開発サーバ http://localhost:4321/samesaengil/
npm run build        # 本番ビルド（dist/、型チェックより厳しい）
npm run typecheck    # astro check（scripts/ も含めて型検査。include:["**/*"]）
npm run test         # smoketest.ts → domtest.ts を順に実行

# 個別テスト（test ランナーは無く、各ファイルが assert で自己完結）
npx tsx scripts/smoketest.ts   # 暦・日付ロジック（almanac / share）
npx tsx scripts/domtest.ts     # jsdom で boot→描画→?d=同期

# データ生成
npm run aggregate              # 全366日を public/data/days/*.json に生成
npx tsx scripts/aggregate.ts 03-15 07-04   # 指定日のみ（argv または ONLY_DAYS=）
AGG_CONCURRENCY=2 npm run aggregate        # 日単位の並列度を下げる（既定3）
```

`npm run aggregate` は実 API を叩く（Wikipedia/Wikidata/日本語版Wikipedia）。レート制限で一部の日が取りこぼれることがある（下記「取りこぼし」参照）。

## Architecture（big picture）

**2 つの独立した半分**——(1) ビルド時のデータパイプライン、(2) ランタイムの SSG＋クライアント描画。両者をつなぐのは `public/data/days/MM-DD.json`（366 ファイル、コミット済み）。

### 1. データパイプライン（`scripts/`）— 1日ぶんを 4 ソースから合成
`scripts/aggregate.ts` が `mapLimit` で日単位並列（既定3）に走り、各日:
- **有名人** `sources/wikiBirths.ts`: 英語版 Wikipedia `onthisday/births/{M}/{D}` REST → 人物ごとに Wikidata Q-ID・サムネ写真・生年・英語 desc。
- **日本語名/知名度** `sources/wikidataEntities.ts`: 上の Q-ID を **`wbgetentities` Action API**（SPARQL ではない）で 50 件ずつ・3 並列補完 → `labels.ja` / `descriptions.ja` / sitelink 数(=fame) / `jawiki` 有無(=jaKnown)。
- **ランキング**（`aggregate.ts` の `buildPeople`）: **jaKnown 優先 → fame 降順 → 写真ありを僅差で優先**、上位 `PEOPLE_PER_DAY`(=24) 件。
- **今日は何の日** `sources/jawikiDay.ts`: 日本語版 Wikipedia「M月D日」を `action=parse`。**節 index はページ毎に違うので、必ず `prop=sections` で取得した一覧から `line` 名（"記念日・年中行事" / "できごと"）で引く**（`fetchDayInfo` が section 一覧を 1 回だけ取り、2 節を `Promise.all` で並行取得）。
- **キャラ**: 静的 `src/data/characters.json` を当日分だけマージ（API なし）。
- **占い/暦は生成しない**。年・月日から計算できるので**クライアント側**（`src/lib/almanac.ts`）で出す。

ソース毎 `try/catch`、失敗時は**前回の per-day ファイル**へフォールバック。横断キャッシュは `src/data/state.json`（`entities`: Q-ID→補完結果、`translations`: 英 desc→日本語訳、`enrichVersion`）。再実行時は未キャッシュの Q-ID だけ取得。翻訳ロジックを変えたら `ENRICH_VERSION` を上げて旧訳を破棄。

英語 desc の日本語化は任意（`sources/translate.ts`、`GEMINI_API_KEY` があれば Gemini で一括翻訳。無ければ英語のまま）。

### 2. 表示（Astro SSG ＋ フレームワーク無しクライアント）
- `src/pages/index.astro`: 年/月/日セレクトのフォーム（SSR）＋空の `#result`、末尾で `boot()` を起動。`Layout.astro` が head/OGP/フッタ。
- `src/app/main.ts` の `boot(root)`: クロージャ状態 ＋ `data-action` 委譲（root に 1 つの click リスナ、入力は form submit / select change）。フロー = 入力読取 → `isValidDate` 検証 → `siteLink('/data/days/MM-DD.json')` を fetch → `almanac.ts` で星座/年齢/干支/和暦を計算 → `render.ts` の文字列ビルダで `#result.innerHTML` を組み立て → `history.replaceState` で `?d=YYYY-MM-DD` 同期。ロード時に `?d=` があれば即描画（共有リンク対応）。
- `src/app/render.ts`: セクション別の HTML 文字列ビルダ（`esc()` で全データをエスケープ）。有名人カードは **イニシャルを背面に置き写真を被せる**方式（`.thumb[data-initials]` ＋ `img.photo onerror="this.remove()"`）＝写真が無い/失敗してもイニシャルが出る。
- `src/app/share.ts`: `?d=` の encode/decode・`isValidDate`/`daysInMonth`/`isLeap` の純関数（DOM 非依存・テスト対象）。
- `src/lib/almanac.ts`: 星座/誕生石/誕生花/干支/和暦/世代/年齢の純関数。`ageOf` は基準日を引数で受ける（`Date.now()` を内部で呼ばない＝テスト可能）。

## 重要な決定・ハマりどころ

- **WDQS（SPARQL）は使わない**: 「指定の月日生まれ」を `FILTER(MONTH/DAY)` で問うクエリは公開 WDQS の 60 秒制限でタイムアウトする。Wikipedia REST ＋ Wikidata Action API のみで構成している。
- **`src/app/*` と `src/lib/*` は相対 import**（`@/` エイリアス禁止）: これらは `scripts/*test.ts` から **tsx** で読み込まれ、tsx はパスエイリアスを解決しないため。`.astro` 内は `@/` で良い（Vite が解決）。`src/lib/url.ts` は `import.meta.env?.BASE_URL ?? "/"` と optional chaining（tsx 下で `import.meta.env` が未定義でも import 時に throw しない）。
- **domtest で `globalThis.navigator` に代入しない**: Node 21+ では読み取り専用 getter になり throw する（CI=Node22 で発覚、ローカル Node20 では通る）。`main.ts` は `navigator.clipboard?.` を optional chaining で参照するだけ。
- **ダークモード**: `color-scheme: light dark` 宣言 ＋ `@media (prefers-color-scheme: dark)` の正規ダークテーマで、ブラウザの自動ダーク化を回避。ただし Chrome の **force-dark フラグ**（`chrome://flags/#enable-force-dark`）有効環境は paint 層で強制されるため CSS から抑止不可（実装の問題ではない）。
- **取りこぼしの直し方**: `npm run aggregate` 全実行後、`people` が空、または `anniversaries`＋`events` が空の日が出ることがある（jawiki/Wikidata のレート制限による一過性エラー）。その日付だけ `AGG_CONCURRENCY=2 npx tsx scripts/aggregate.ts <MM-DD ...>` で再実行すれば、成功するまで何度でも上書きできる（成功日は触らない）。
- **CI は push 時 aggregate をスキップ**（`.github/workflows/update-and-deploy.yml`）: データ再生成は `schedule`（週1）/`workflow_dispatch` のみ。push 時はコミット済みデータでビルドするだけ＝データ bot のコミット→push→再生成 の無限ループ防止。push 時も typecheck/test/build は走る。
- **キャラは手動 JSON**（`src/data/characters.json`、`{name, work, month, day, color?}`）。**ONE PIECE も他作品と同じ 1 ソース**として平等に扱い特別扱いしない。**フィクションキャラの画像は著作権配慮で掲載しない**（名前＋作品名＋色チップのみ）。
- **生成データはコミットする**（`.gitignore` で除外しない）: 初回 push のデプロイは aggregate をスキップするため、コミット済みの `public/data/**` がそのまま公開される＝全日完備が前提。
- **base path**: `astro.config.mjs` の `base:"/samesaengil"`。JS で組む内部リンク・`public/` への fetch は必ず `siteLink()` を通す。CI では `GH_USER` を `github.repository_owner` で上書き。Tailwind v4 の Vite プラグインは型不一致のため `astro.config.mjs` で `any` キャスト。
