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

### 1. データパイプライン（`scripts/`）— 1日ぶんを日本語版Wikipediaから生成
**人物リストは日本語版Wikipediaのみ**（英語版 births マージは廃止）。`scripts/aggregate.ts` が `mapLimit` で日単位並列（既定3）に走り、各日:
- **誕生日（主ソース）** `sources/jawikiDay.ts` の `fetchDayInfo().births`/`.animals`: 日本語版 Wikipedia「M月D日」の **`誕生日` 節**を `action=parse&prop=wikitext` で取得し、`* 1789年 - [[ゲオルク・オーム]]、[[物理学者]]` 形の各行を「生年・jawiki タイトル・表示名・日本語肩書き」に分解（~150〜220人/日）。`=== 人物以外（動物など）` 見出しを境に**人物(births)と動物(animals)を分離**。生年非公表/不詳は `year:null`。
- **写真＋正規化タイトル** `sources/jawikiPageMeta.ts`: 上の jawiki タイトル群を `action=query&prop=pageimages|pageprops`（50件バッチ・3並列・redirects/normalized 追従）で **顔写真サムネ・リダイレクト解決後の正規化タイトル**（＋Q-ID）に一括解決。正規化タイトルは閲覧数取得の精度に必要（変体字・リダイレクト対策。例: `髙橋大輔`→正規記事）。存命の日本人は著作権で写真なしが多い（イニシャル fallback）。
- **人気（並び替え指標＝閲覧数）** `sources/jawikiPageviews.ts`: 正規化タイトルを Wikimedia REST **pageviews API**（`wikimedia.org/.../per-article/ja.wikipedia/...`＝ja.wikipedia とは別ホスト）で**直近12か月の年間閲覧数(=fame)**に解決。metrics API は **1 IP あたり ~6 並列**を超えると 429 を返す（実測: 6=クリーン, 7 で混入, 8+ 全滅）ため、日並列(`AGG_CONCURRENCY`)と無関係に**総同時実行数を 6 に固定するモジュール共有セマフォ**を噛ませる（グローバルゲート外＝`gate:false`）。**人物リストは増やさず、閲覧数は並び順にだけ使う**。SPARQL/Wikidata sitelink 方式は「世界的知名度」で日本の人気とズレる（旧: 米大統領が上位）ため廃止。
- **ランキング**（`aggregate.ts` の `buildPeopleAndAnimals`）: 名前・肩書きは日本語リスト由来、写真は ja pageimages。**正規化タイトルで重複排除**し、並びは **閲覧数(fame) 降順 → 写真あり → 生年新しい順**（＝日本でよく見られている人が上位）。**全件**を JSON に保存し、表示側で先頭30件＋「もっと見る」遅延描画。動物は別配列 `animals`。
- **今日は何の日** 同じ `fetchDayInfo`（節一覧は 1 回だけ引き、`誕生日`/`記念日・年中行事`/`できごと` の 3 節を `Promise.all` で並行取得）。**節 index はページ毎に違うので必ず `prop=sections` の `line` 名で引く**。
- **キャラ**: 静的 `src/data/characters.json` を当日分だけマージ（API なし）。
- **占い/暦は生成しない**。年・月日から計算できるので**クライアント側**（`src/lib/almanac.ts`）で出す。

ソース毎 `try/catch`、失敗時は**前回の per-day ファイル**へフォールバック（jawiki 誕生日が取れなかった日のみ people/animals を前回値に戻す）。横断キャッシュは `src/data/state.json`（`pages`: jawiki title→{qid,photo,正規化タイトル}（負キャッシュ `{}` 込み）、`views`: 正規化タイトル→年間閲覧数）。再実行時は未キャッシュの title/閲覧数だけ取得。旧スキーマの `entities`/`translations` は `run()` 冒頭で破棄して state を軽く保つ。

### 2. 表示（Astro SSG ＋ フレームワーク無しクライアント）
- `src/pages/index.astro`: 年/月/日セレクトのフォーム（SSR）＋空の `#result`、末尾で `boot()` を起動。`Layout.astro` が head/OGP/フッタ。
- `src/app/main.ts` の `boot(root)`: クロージャ状態 ＋ `data-action` 委譲（root に 1 つの click リスナ、入力は form submit / select change）。フロー = 入力読取 → `isValidDate` 検証 → `siteLink('/data/days/MM-DD.json')` を fetch → `almanac.ts` で星座/年齢/干支/和暦を計算 → `render.ts` の文字列ビルダで `#result.innerHTML` を組み立て → `history.replaceState` で `?d=YYYY-MM-DD` 同期。ロード時に `?d=` があれば即描画（共有リンク対応）。
- `src/app/render.ts`: セクション別の HTML 文字列ビルダ（`esc()` で全データをエスケープ）。有名人カードは **イニシャルを背面に置き写真を被せる**方式（`.thumb[data-initials]` ＋ `img.photo onerror="this.remove()"`）＝写真が無い/失敗してもイニシャルが出る。
- `src/app/share.ts`: `?d=` の encode/decode・`isValidDate`/`daysInMonth`/`isLeap` の純関数（DOM 非依存・テスト対象）。
- `src/lib/almanac.ts`: 星座/誕生石/誕生花/干支/和暦/世代/年齢の純関数。`ageOf` は基準日を引数で受ける（`Date.now()` を内部で呼ばない＝テスト可能）。

## 重要な決定・ハマりどころ

- **WDQS（SPARQL）・Wikidata は使わない**: 「指定の月日生まれ」を `FILTER(MONTH/DAY)` で問う SPARQL は公開 WDQS の 60 秒制限でタイムアウトする。並び替え指標も Wikidata sitelink から**日本語版の閲覧数**に移行したため、現在は **日本語版Wikipedia REST（parse/query）＋ Wikimedia pageviews API のみ**で構成（Wikidata は不使用）。
- **`src/app/*` と `src/lib/*` は相対 import**（`@/` エイリアス禁止）: これらは `scripts/*test.ts` から **tsx** で読み込まれ、tsx はパスエイリアスを解決しないため。`.astro` 内は `@/` で良い（Vite が解決）。`src/lib/url.ts` は `import.meta.env?.BASE_URL ?? "/"` と optional chaining（tsx 下で `import.meta.env` が未定義でも import 時に throw しない）。
- **domtest で `globalThis.navigator` に代入しない**: Node 21+ では読み取り専用 getter になり throw する（CI=Node22 で発覚、ローカル Node20 では通る）。`main.ts` は `navigator.clipboard?.` を optional chaining で参照するだけ。
- **ダークモード**: `color-scheme: light dark` 宣言 ＋ `@media (prefers-color-scheme: dark)` の正規ダークテーマで、ブラウザの自動ダーク化を回避。ただし Chrome の **force-dark フラグ**（`chrome://flags/#enable-force-dark`）有効環境は paint 層で強制されるため CSS から抑止不可（実装の問題ではない）。
- **Wikimedia の 429 対策（2系統の調停）**: `scripts/lib/util.ts` の `fetchJson`/`fetchText` は既定で**グローバルな同時実行ゲート**（同時2・開始間隔200ms、`AGG_MAX_CONCURRENT`/`AGG_MIN_GAP_MS`）を通し、`ja.wikipedia.org` 系（parse/query）を全体で絞る。429 は `Retry-After` 優先のバックオフでリトライ、**4xx（404 等）は即失敗**（`HttpError.status`＜500 で判定）。一方 **pageviews API は別ホスト**なので `gate:false` でこのゲートを外し、代わりに `jawikiPageviews.ts` の**専用共有セマフォ（同時6）**で絞る（`PV_CONCURRENCY`）。**初回フル実行は title 解決＋閲覧数取得が大量（各~9万件）で ~90分**かかるが、`state.pages`（title→{qid,photo,正規化タイトル}）と `state.views`（正規化タイトル→閲覧数）にキャッシュされ再実行は速い。どちらのゲート/セマフォも上限を上げると 429 が多発し、その日の people が前回値へフォールバックして網羅性が落ちる（pageviews は 7 並列で既に混入）。
- **取りこぼしの直し方**: `npm run aggregate` 全実行後、`people` が空、または `anniversaries`＋`events` が空の日が出ることがある（レート制限の一過性エラー）。その日付だけ `npx tsx scripts/aggregate.ts <MM-DD ...>` で再実行すれば、成功するまで何度でも上書きできる（成功日は触らない）。
- **誕生日パースの注意**: `jawikiDay.ts` の `parseBirthLine` は「名前、肩書き（+ 没年）」構造を前提に、**末尾の没年注記を先に落としてから最初の読点までを名前**にする（でないと未リンクの人名行で末尾の `[[没年]]` をリンクとして拾い、名前が「2008年」等になる）。`aggregate.ts` の `isYearLike` は年名エントリ除外の保険（現状ほぼ発火しない）。
- **CI は push 時 aggregate をスキップ**（`.github/workflows/update-and-deploy.yml`）: データ再生成は `schedule`（週1）/`workflow_dispatch` のみ。push 時はコミット済みデータでビルドするだけ＝データ bot のコミット→push→再生成 の無限ループ防止。push 時も typecheck/test/build は走る。
- **キャラは手動 JSON**（`src/data/characters.json`、`{name, work, month, day, color?}`）。**ONE PIECE も他作品と同じ 1 ソース**として平等に扱い特別扱いしない。**フィクションキャラの画像は著作権配慮で掲載しない**（名前＋作品名＋色チップのみ）。
- **生成データはコミットする**（`.gitignore` で除外しない）: 初回 push のデプロイは aggregate をスキップするため、コミット済みの `public/data/**` がそのまま公開される＝全日完備が前提。
- **base path**: `astro.config.mjs` の `base:"/samesaengil"`。JS で組む内部リンク・`public/` への fetch は必ず `siteLink()` を通す。CI では `GH_USER` を `github.repository_owner` で上書き。Tailwind v4 の Vite プラグインは型不一致のため `astro.config.mjs` で `any` キャスト。
