# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

生年月日を入れると、その誕生日にまつわる情報（同じ誕生日の有名人＝顔写真つき・フィクションキャラ・記念日・**その年の出来事＋生まれた週のオリコン1位（Spotify リンク・ジャケットつき、その年の週間1位一覧も）**・**同じ学年の有名人＝芸能/スポーツ/音楽…のカテゴリ別**・星座/誕生石/誕生花/年齢/干支/和暦・**曜日/月齢/生誕日数/数秘/九星**）が出てくる若者向け静的サイト。Astro 5 + Tailwind v4 + TypeScript、GitHub Pages（Actions デプロイ）。公開: https://satory074.github.io/samesaengil/

## Commands

```bash
npm run dev          # 開発サーバ http://localhost:4321/samesaengil/
npm run build        # 本番ビルド（dist/、型チェックより厳しい）
npm run typecheck    # astro check（scripts/ も含めて型検査。include:["**/*"]）
npm run test         # smoketest.ts → domtest.ts を順に実行

# 個別テスト（test ランナーは無く、各ファイルが assert で自己完結）
npx tsx scripts/smoketest.ts   # 純関数（almanac / share / year / oshi / peers / photos / initials）
npx tsx scripts/domtest.ts     # jsdom で boot→描画→?d=同期

# データ生成（日別 → 年 の順。年パイプラインは日別 JSON を入力にする）
npm run aggregate              # 全366日を public/data/days/*.json に生成
npx tsx scripts/aggregate.ts 03-15 07-04   # 指定日のみ（argv または ONLY_DAYS=）
AGG_CONCURRENCY=2 npm run aggregate        # 日単位の並列度を下げる（既定3）
PHOTOS_ONLY=1 npm run aggregate            # 日ページを叩かず「顔写真の無い人」だけ外部ソースで補完
npm run aggregate:years        # 1900〜今年を public/data/years/YYYY.json に生成（~4分）
npx tsx scripts/aggregateYears.ts 1995     # 指定年のみ（argv または ONLY_YEARS=）
YEARS_PEOPLE_ONLY=1 npm run aggregate:years  # API を叩かず「同じ年に生まれた有名人」だけ再生成（全127年で数秒）
npm run rank:works             # 作品の人気（閲覧数）を state.json に貯める（キャラの並び順用）

# 1回だけ実行する取込スクリプト（生成物はコミット済み。通常は再実行不要）
npm run import:characters      # bd.fan-web.jp → src/data/characters-fanweb.json
npm run import:char-images     # AniList → src/data/anilist.json（キャラ画像。人気順・再開可能・~1-2h）
npm run import:font            # Noto Sans JP → src/assets/fonts/NotoSansJP-Subset.ttf（OG画像用）
```

`npm run aggregate` / `aggregate:years` / `rank:works` は実 API（日本語版Wikipedia・Wikidata・Spotify）を叩く。レート制限で一部が取りこぼれることがある（下記「取りこぼし」参照）。**顔写真の補完は認証不要（Wikimedia のみ）＝キーは要らない。**

**環境変数（すべて任意。無ければその段をスキップするだけで壊れない）**: `.env` に置けば `dotenv/config` で読まれる。CI では同名の Secret。
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` … **オリコン1位曲の Spotify リンク解決のみ**（未設定なら表示側は検索 URL にフォールバック）。顔写真には使わない。
- 顔写真まわりのつまみ: `PHOTO_MIN_FAME`（P18 を試す閲覧数の下限。既定 5000）／`PHOTO_RECHECK=1`（「写真なし」の負キャッシュを引き直す）／`PHOTO_COMMONS=1`（Commons depicts 段を有効化。既定オフ・遅い）

## Architecture（big picture）

**2 つの独立した半分**——(1) ビルド時のデータパイプライン、(2) ランタイムの SSG＋クライアント描画。両者をつなぐのは `public/data/days/MM-DD.json`（366 ファイル）と `public/data/years/YYYY.json`（127 ファイル、1900〜今年）。どちらもコミット済み。

### 1. データパイプライン（`scripts/`）— 1日ぶんを日本語版Wikipediaから生成
**人物リストは日本語版Wikipediaのみ**（英語版 births マージは廃止）。`scripts/aggregate.ts` が `mapLimit` で日単位並列（既定3）に走り、各日:
- **誕生日（主ソース）** `sources/jawikiDay.ts` の `fetchDayInfo().births`/`.animals`: 日本語版 Wikipedia「M月D日」の **`誕生日` 節**を `action=parse&prop=wikitext` で取得し、`* 1789年 - [[ゲオルク・オーム]]、[[物理学者]]` 形の各行を「生年・jawiki タイトル・表示名・日本語肩書き」に分解（~150〜220人/日）。`=== 人物以外（動物など）` 見出しを境に**人物(births)と動物(animals)を分離**。生年非公表/不詳は `year:null`。
- **写真＋正規化タイトル** `sources/jawikiPageMeta.ts`: 上の jawiki タイトル群を `action=query&prop=pageimages|pageprops`（50件バッチ・3並列・redirects/normalized 追従）で **顔写真サムネ・リダイレクト解決後の正規化タイトル**（＋Q-ID）に一括解決。正規化タイトルは閲覧数取得の精度に必要（変体字・リダイレクト対策。例: `髙橋大輔`→正規記事）。**`missing` フラグを必ず見る**——見ていなかった頃は存在しない記事（赤リンク）が `{title}` として「解決済み」に固着し、死んだ Wikipedia リンクを描画していた。
- **顔写真のフォールバック** `sources/photos.ts`（**認証不要＝Wikimedia のみ**）: jawiki は非自由画像を認めないので、**存命の日本の俳優・タレントは記事に写真が無い**（写真なしの 97% がこれ。取りこぼしではなく構造的）。しかもその層こそ閲覧数が高くカードの先頭に来る。写真が取れなかった人だけ補完する（`fame >= PHOTO_MIN_FAME`＝既定5000 の人のみ）:
  1. **Wikidata P18** … `state.pages` に既にある Q-ID を 50件バッチで `wbgetentities`（claims|labels|aliases）に引く。**ただし P18 は「項目の代表画像」であって顔写真とは限らない**——実例: 今田美桜の P18 は `Nagoya PARCO seen from Otsu-dori.jpg`（彼女の広告看板が写った**建物**）。拒否リストでは弾けないので、**ファイル名が本人の名前を含むこと**を採用条件にする（`p18FileMatchesPerson`）。Wikidata の英語ラベルはマクロン付き（`Hikaru Tōno`）なのに Commons のファイル名は素の綴り（`Tono Hikaru 2020.jpg`）なので、**発音記号を落として突き合わせる**（ここを忘れると長音を含む日本人名が軒並み弾かれる）。ファイル名→320px サムネは Commons `imageinfo`。
  2. **Commons SDC depicts**（既定オフ・`PHOTO_COMMONS=1`）… 1人1コールでバッチできず遅い割に、実測で P18 とほぼ同じファイルしか返さない。名前照合つき。
  - **無認証の上限は写真なし層の ~9%**（＝Wikimedia に自由ライセンス写真が存在する割合そのもの）。残り（俳優の大半）は原理的に埋まらないので、表示側のプレースホルダで補う。**TMDB でその層を埋める案は「キー・登録不要」の要望により不採用**（過去に実装したが削除した。再び使うなら再実装が要る）。**Commons 名前検索は不採用**——filename に本人名を含んでも「やなせたかし」がアンパンマン記念碑（panoramio 写真）、「あの」が音声(.wav)にヒットし誤爆率 ~50%。
  - キャッシュは `state.photos`（要求タイトル → `{url, src, v}`、`url:""` は「全段外れた」の負キャッシュ）。ロジックを変えたら `state.ts` の **`PHOTO_VERSION` を上げる**と全件引き直す。
- **人気（並び替え指標＝閲覧数）** `sources/jawikiPageviews.ts`: 正規化タイトルを Wikimedia REST **pageviews API**（`wikimedia.org/.../per-article/ja.wikipedia/...`＝ja.wikipedia とは別ホスト）で**直近12か月の年間閲覧数(=fame)**に解決。metrics API は **1 IP あたり ~6 並列**を超えると 429 を返す（実測: 6=クリーン, 7 で混入, 8+ 全滅）ため、日並列(`AGG_CONCURRENCY`)と無関係に**総同時実行数を 6 に固定するモジュール共有セマフォ**を噛ませる（グローバルゲート外＝`gate:false`）。**人物リストは増やさず、閲覧数は並び順にだけ使う**。SPARQL/Wikidata sitelink 方式は「世界的知名度」で日本の人気とズレる（旧: 米大統領が上位）ため廃止。
- **ランキング**（`aggregate.ts` の `buildPeopleAndAnimals`）: 名前・肩書きは日本語リスト由来、写真は ja pageimages。**正規化タイトルで重複排除**し、並びは **閲覧数(fame) 降順 → 写真あり → 生年新しい順**（＝日本でよく見られている人が上位）。**全件**を JSON に保存し、表示側で先頭30件＋「もっと見る」遅延描画。動物は別配列 `animals`。
- **今日は何の日** 同じ `fetchDayInfo`（節一覧は 1 回だけ引き、`誕生日`/`記念日・年中行事`/`できごと` の 3 節を `Promise.all` で並行取得）。**節 index はページ毎に違うので必ず `prop=sections` の `line` 名で引く**。
- **キャラ**: 2 つの静的シードを当日分だけマージ（実行時 API なし）。(a) 手描きの curated `src/data/characters.json`（色つき）、(b) **bd.fan-web.jp 由来のバルク** `src/data/characters-fanweb.json`（全366日 ~7.5万件、名前＋作品名のみ）。マージは `aggregate.ts` の `buildCharacterMap`＝日ごと `name` で重複排除（curated 先勝ち）、fanweb 分の色は `colorForWork(work)`（作品名ハッシュ→固定 S/L の HSL）で自動導出。
- **キャラの並び（`rankCharacters`）**: **作品の閲覧数(人気)降順 → 作品名（同作品を隣接）→ 作品内は seed 順**（`Array#sort` は安定）。作品の人気は**人物の fame と同じ仕組み**——作品名を jawiki のタイトルとみなして `resolveWorkFame()`（`scripts/lib/state.ts`）が pageMeta＋pageviews で解決し、同じ `state.pages`/`state.views` にキャッシュする（記事が無い作品は 0＝後ろへ）。初期表示は先頭40件なので、ここが**実質ランダムだと有名作品が埋もれる**（旧: fanweb のスクレイプ順そのまま）。
- **占い/暦は生成しない**。年・月日から計算できるので**クライアント側**（`src/lib/almanac.ts`）で出す。

ソース毎 `try/catch`、失敗時は**前回の per-day ファイル**へフォールバック（jawiki 誕生日が取れなかった日のみ people/animals を前回値に戻す）。横断キャッシュは `src/data/state.json`（`pages`: jawiki title→{qid,photo,正規化タイトル}（負キャッシュ `{}` 込み）、`views`: 正規化タイトル→年間閲覧数、`photos`: jawiki title→外部ソース由来の顔写真）。人物のタイトルも作品名も**同じキー空間（jawiki の記事タイトル）**なので同居させている。読み書き・解決は `scripts/lib/state.ts` に集約（`readState`/`writeState`/`ensurePages`/`ensurePageviews`/`ensurePhotos`/`resolveWorkFame`）＝ `aggregate.ts` と `rankWorks.ts` で共有。再実行時は未キャッシュの title/閲覧数/写真だけ取得。旧スキーマの `entities`/`translations` は `readState()` で破棄して state を軽く保つ。

**キャッシュのスティッキーさに注意**: `ensurePages` は「正規化タイトルがあれば最新」とみなして二度と引き直さないので、jawiki が後から画像を足しても**フル再実行しても写真は増えない**。`PHOTO_RECHECK=1` がその脱出口（`pages` の写真なしと `photos` の負キャッシュを両方引き直す）。

**顔写真だけを補完する高速パス**: `PHOTOS_ONLY=1 npm run aggregate` は jawiki の「M月D日」ページを一切叩かず、既存 per-day ファイルの**写真が無い人だけ**を外部ソースにかけて `photo` を差し替える（`CHARS_ONLY=1` と同じ発想）。全366日ぶんの候補を先に集めてから 1 回で解決するので Wikidata の 50 件バッチが効く。**日別を更新したら `YEARS_PEOPLE_ONLY=1 npm run aggregate:years` で「同じ学年」側にも反映する**（年 JSON は日別の写真をコピーしているため）。

### 1b. 「生まれた年」パイプライン（`scripts/aggregateYears.ts`）— 年軸のデータ
`aggregate.ts` と同じ規範（ソース毎 try/catch・前回値フォールバック・`mapLimit`）で `public/data/years/YYYY.json`（1900〜今年）を生成。**`DayData` には一切触らない**＝日パイプラインと完全独立。
- **その年のできごと** `sources/jawikiYear.ts`: 「YYYY年」記事。**`toclevel === 1`（トップレベル）の節だけ**を名前で引く——年記事では `1月` という節名が `できごと`/`誕生`/`死去` の**3か所**に出るため、`jawikiDay.ts` の `Map<line,index>`（後勝ち）をそのまま流用すると**「死去」節を掴む**。トップレベル節名も揺れる（`できごと` が普通だが 1995年だけ `出来事・事柄`）ので候補リストで解決。`section=N` は小節も含めて返すので **12か月ぶんが 1 リクエストで揃う**。行は `* [[1月17日]] - …` だが **年によって日付がリンクでない**（2006/2009 は `* 1月2日 - …`）ので `[[ ]]` は任意。`主な出来事` 小節は `;日本国内` グループを優先して `highlights` に。
- **生まれた週のオリコン1位** `sources/jawikiOricon.ts`: `Template:オリコン週間シングルチャート第1位 YYYY年`（**1968年〜**）。実データで確認した表記ゆれを全部吸収する（パラメータ/箇条書きの空白、複数日 `23日・30日`、`（合算週: 2週分）`、半角括弧のアーティスト、タイトル内の括弧、未リンクのアーティスト、`&` を含む名前）。**存在しない年でも HTTP 200 + `{"error":{"code":"missingtitle"}}` が返る**ので `HttpError` ではなく `parse.wikitext` の有無で判定する。
- 「生まれた週の1位」は **誕生日以前で最も近い週**。年始生まれのために `prevYearLast`（前年の最終週）を持たせ、選択はクライアントの純関数 `src/lib/year.ts` の `songForBirthday()` で行う（JSON は年単位なので特定の誕生日には解決できない）。
- **Spotify リンク＋ジャケット** `sources/spotify.ts`: Client Credentials でトークンを取り、`search?type=track&market=JP` を**フリーテキスト**（曲名＋アーティスト）で引いて**結果側で照合**する（`track:"..." artist:"..."` のフィールド指定は邦楽で取りこぼす）。照合は NFKC＋小文字化＋記号除去の緩い包含一致。ヒットしたら `ChartWeek.spotify` に曲ページ URL、`ChartWeek.cover` に album.images から選んだ**ジャケット（~300px、`pickCover`）**。キャッシュは `src/data/spotify.json`（`"曲名|アーティスト" -> {url, cover?}`、`{url:""}` は**「Spotify に無い」の負キャッシュ**。旧スキーマの string 値（URL のみ）は `entryOf()` で互換読み／ネットワーク失敗はキャッシュせず次回再試行。`SPOTIFY_RECHECK=1` で負キャッシュと cover 無しの旧 string 値も引き直す）。**資格情報が無ければ解決をスキップ**し、表示側 `spotifyUrl()`（`src/lib/year.ts`）が**検索 URL にフォールバック**、ジャケットは 🎵 プレースホルダ＝古いデータでも必ず飛べる・壊れない。別ホストなので `gate:false`＋専用セマフォ（同時4・`SPOTIFY_CONCURRENCY`）＋**開始間隔 500ms**（`SPOTIFY_MIN_GAP_MS`）。**Spotify の制限はアプリ（Client ID）単位**で、超えると **429 + `Retry-After` ≈ 24時間の長期 ban** になる（IP を変えても無意味）。しかも**レートではなく日次の総量制限**とみられる——開始間隔 500ms（120 req/分）に絞っても**送信 ~700〜900 件付近で ban**（2026-08 に2回実測。1回目は間隔なし・2分）。対策は4段: 開始間隔で絞る／**1実行の送信上限 600 件**（`SPOTIFY_MAX_REQUESTS`。超過分は次回実行=週次 cron に持ち越し）／`max429WaitMs`（60秒）を超える Retry-After は sleep せず即失敗（前は無条件に従ってパイプラインが丸ごとハングした）／429 を一度観測したらその実行では以降の曲を全部スキップ（サーキットブレーカー）。失敗はキャッシュされないので次回自然に再試行＝数回の実行で全曲が埋まる。
- **同じ学年の有名人**（`YearData.people`）: **新しいソースも API 呼び出しも無い**。`aggregate.ts` が作った日別 JSON 366ファイルには既に人物の生年・肩書き・写真・人気（fame＝年間閲覧数）が入っている（計 ~8.9万人）ので、`buildCohortPeople()` が**それを学年で逆引きする**だけ（ローカル I/O のみ・数秒）。したがって**日別 → 年 の実行順が必須**（CI もその順）。
  - **キーは暦年ではなく学年（年度）**: `YYYY.json` の `people` は「**YYYY/4/2 〜 YYYY+1/4/1 生まれ**」＝早生まれ（翌年1〜3月生まれ）が混ざる。同じファイルの `events`/`chartWeeks` は**暦年**なので、**1ファイル内で people だけ意味が違う**ことに注意。日本で「同い年」といえば同学年だからこうしている（判定は `src/lib/peers.ts` の `cohortYearOf`）。
  - 並びは人物と同じ規範（fame 降順 → 写真あり → 名前）、重複排除は URL。**カテゴリ（`categorize`）ごとに上位30人でカット**＝最大150人/学年。全件だと 470KB/年になり、年 JSON は診断のたびに fetch されるホットパスなので上限は必須（現状 +30KB/年）。
  - 日別が読めないときは people を空で上書きせず前回値を維持する（`invertOk`）。**`YEARS_PEOPLE_ONLY=1` で Wikipedia/Oricon/Spotify を一切叩かず people だけ差し替え**（`aggregate.ts` の `CHARS_ONLY=1` と同じ発想。日別を再生成したあとの反映はこれで数秒）。
- **パーサ破損の検知**: 「できごと0件」「1968年以降なのに週間1位0件」「1920〜2005年なのに有名人0人」の年をログに列挙する。Wikipedia のテンプレ/節構成は編集されるので、サイレント破損はこれで気付く。Spotify も「新規解決/未収録/失敗」の件数をログに出す。

### 2. 表示（Astro SSG ＋ フレームワーク無しクライアント）
- `src/pages/index.astro`: **サイトはこの1ページだけ**。年/月/日セレクトのフォーム（SSR）＋空の `#result`、末尾で `boot()` を起動。`components/Layout.astro` が head/OGP/フッタ（`title`/`description`/`canonical`/`image` の props）。
- `src/pages/og/default.png.ts`: satori + resvg で **OG画像(1200x630)をビルド時に生成**（`src/lib/og.ts`）。静的ホスティングでは `?d=` ごとに OG を差し替えられないので**日付なしの汎用カード1枚**。PNG は**コミットしない**。
- `src/app/main.ts` の `boot(root)`: クロージャ状態 ＋ `data-action` 委譲。フロー = 入力読取 → `isValidDate` 検証 → **per-day・per-year・per-学年 を `Promise.all` で並行 fetch**（学年は早生まれだと暦年の1つ前のファイルになるので別途引く。同じ年ならファイルを共用して余計な fetch をしない） → `almanac.ts` で暦を計算 → `render.ts` で `#result.innerHTML` を組み立て → `history.replaceState` で `?d=YYYY-MM-DD` 同期。ロード時に `?d=` があれば即描画。`normalizeDay`/`normalizeYear` が古い JSON の欠損キーを既定値で補う（**新キー追加時は必ずここも**）。**不正日付はフォーム直下の `.form-error`（role=alert）に出し、前回の結果と URL は消さない**（以前は `#result` を上書きしていて画面と `?d=` が食い違った）。**フォーム送信時だけ** `#result` へ `scrollIntoView`（`?d=` 付きロード時は飛ばさない。reduced-motion なら behavior:auto）。
- `src/app/render.ts`: セクション別の HTML 文字列ビルダ（`esc()` で全データをエスケープ）。`resultHtml` が**唯一のセクション順序定義**。**全セクションは `<details class="section">` の折りたたみで初期は全閉**（`section()` ヘルパー1箇所で生成。`class="section"` は more.ts の `.closest(".section")` が依存するので変更不可。domtest も `.section` クラスで引く——`<section>` タグではないため）。診断ごとに `#result` は総入れ替えなので開閉状態は毎回リセット。🎂 セクション内に**その年の週間1位ぜんぶの一覧**（`chartListHtml`＝ネスト details）。誕生週のハイライトは **`w === song` の参照比較**——`songForBirthday` は chartWeeks の要素参照か prevYearLast を返すので、month/day 比較だと年始生まれ（song=前年末週）で当年の同月日週を誤ハイライトする。参照比較なら prevYearLast は一覧に無い＝自然にハイライト無し。ジャケットは有名人写真と同じ「プレースホルダ背面＋img 重ね＋onerror で戻る」流儀（`.cw-art`/🎵）。有名人カードは **イニシャルを背面に置き写真を被せる**方式（`.thumb[data-initials]` ＋ `img.photo onerror="this.remove()"`）＝写真が無い/失敗してもイニシャルが出る。**写真なしは例外ではなく一覧の 3〜4 割**（上記の構造的な理由）なので、プレースホルダは「主要な見た目」として作る: イニシャルは 2 文字（`今田美桜`→`今田`、`ゲオルク・オーム`→`ゲオ`）、`.thumb[data-cat]`（肩書きのカテゴリ＝`peers.ts` の `categorize`）で色相を出し分けて「読み込み失敗の灰色」ではなく「分類された色チップ」に見せる。キャラは1日 数百〜千件になりうるため（例 7/7 で ~1900 件）、有名人と同じく **先頭 `CHARS_VISIBLE`(=40) 件＋「もっと見る」遅延描画**。キャラ一覧は**作品ごとのグループ見出し**（`charRows`。作品人気順ソートで同一作品が隣接している前提。チップ側の作品名は省き、「もっと見る」境界では直前の作品名を引き継いで見出しの重複を防ぐ）。記念日セクションの見出しは**「M月D日は何の日」**（「今日」ではない）で、位置は「生まれた年」の直後（数百件のキャラ一覧の下だと辿り着けないため）。
- `src/app/more.ts`: 「もっと見る」の click 委譲。描画済みの全件配列から残りを `insertAdjacentHTML` で足す（初期 DOM を軽く保つため、有名人30件・キャラ40件・同い年はカテゴリごと12件だけ先に描く）。同い年だけはカテゴリ別にグリッドが分かれるので、ボタンの `data-cat` と `[data-year-grid="<cat>"]` で対応づける。
- `src/app/share.ts`: `?d=` の encode/decode・`isValidDate`/`daysInMonth`/`isLeap` の純関数（DOM 非依存・テスト対象）。
- `src/lib/almanac.ts`: 星座/誕生石/誕生花/干支/和暦/世代/年齢 ＋ **ユリウス通日(JDN)ベース**の曜日/月齢/生誕日数/キリ番記念日/数秘ライフパス/九星の純関数。**`Date` を内部で使わない**（`ageOf`/`daysLivedOf` は基準日を引数で受ける）＝テスト可能。
- `src/lib/days.ts`: `allDays()`（366日の列挙）。`aggregate.ts` が全日を回すのに使う（`aggregateYears.ts` の逆引きも）。
- `src/lib/peers.ts`: 「同じ学年の有名人」セクションの学年判定・分類（新ソース無し。`oshi.ts` と同じ思想）。
  - `cohortYearOf(ymd)`: その生年月日が属する**学年（年度）**＝ `4/2 〜 翌4/1`。**4月1日生まれは早生まれで前の学年**（年齢は誕生日の前日終了時に加算されるため）。1995/6/18→1995年度、1995/3/15→1994年度、1995/4/1→1994年度、1995/4/2→1995年度。
  - `categorize(desc)`: 肩書きを 芸能/スポーツ/音楽/文化・アート/その他 に分ける——**最初にマッチしたキーワードの位置が最も早いカテゴリ**を採るので、jawiki の肩書きが主業を先頭に置く性質（「元アナウンサー、タレント」→芸能、「歌手、俳優」→音楽）に沿う。「陸上」ではなく「陸上競技」で見ている（陸上自衛官を拾わないため）。
  - `exactMatchesOf` は生年月日まで一致する人（⭐）を**日別データ**から引く（年 JSON はカテゴリ上限で切られていて漏れるため）。`withoutExact` がその人をカテゴリ側から除く＝同一セクション内の二重表示を防ぐ。**この2つは `render.ts` と `main.ts`（もっと見る用の配列）の両方で同じ切り方を再現する必要がある**。
- `src/lib/oshi.ts`: 「推し」セクションの**再カット**（新ソース無し）。VTuber は既に `characters`（fanweb の作品名 `にじさんじ`/`ホロライブプロダクション`/`ぶいすぽっ！`/`バーチャルYouTuber`＝表記ゆれで `Youtuber` もある）に、K-POP アイドルは既に `people` の肩書き（例「アイドル、歌手（BTS）」）に入っているが、1日最大1932件のキャラ一覧・200人超の有名人一覧に埋もれている。それを拾い直すだけ＝**スクレイプもデータ増加もしない**。元の一覧からは除外しない（推しは「ハイライト」で、全件は元セクションで見られる）。**K-POP グループ名のラテン文字は単語境界を要求する**（でないと `Aivery` が `IVE` に、`KARAOKE` が `KARA` に部分一致する）。

## 重要な決定・ハマりどころ

- **WDQS（SPARQL）・Wikidata は使わない**: 「指定の月日生まれ」を `FILTER(MONTH/DAY)` で問う SPARQL は公開 WDQS の 60 秒制限でタイムアウトする。並び替え指標も Wikidata sitelink から**日本語版の閲覧数**に移行したため、現在は **日本語版Wikipedia REST（parse/query）＋ Wikimedia pageviews API のみ**で構成（Wikidata は不使用）。
- **`src/app/*` と `src/lib/*` は相対 import**（`@/` エイリアス禁止）: これらは `scripts/*test.ts` から **tsx** で読み込まれ、tsx はパスエイリアスを解決しないため。`.astro` 内は `@/` で良い（Vite が解決）。`src/lib/url.ts` は `import.meta.env?.BASE_URL ?? "/"` と optional chaining（tsx 下で `import.meta.env` が未定義でも import 時に throw しない）。
- **domtest で `globalThis.navigator` に代入しない**: Node 21+ では読み取り専用 getter になり throw する（CI=Node22 で発覚、ローカル Node20 では通る）。`main.ts` は `navigator.clipboard?.` を optional chaining で参照するだけ。
- **ダークモード**: `color-scheme: light dark` 宣言 ＋ `@media (prefers-color-scheme: dark)` の正規ダークテーマで、ブラウザの自動ダーク化を回避。ただし Chrome の **force-dark フラグ**（`chrome://flags/#enable-force-dark`）有効環境は paint 層で強制されるため CSS から抑止不可（実装の問題ではない）。
- **Wikimedia の 429 対策（2系統の調停）**: `scripts/lib/util.ts` の `fetchJson`/`fetchText` は既定で**グローバルな同時実行ゲート**（同時2・開始間隔200ms、`AGG_MAX_CONCURRENT`/`AGG_MIN_GAP_MS`）を通し、`ja.wikipedia.org` 系（parse/query）を全体で絞る。429 は `Retry-After` 優先のバックオフでリトライ、**4xx（404 等）は即失敗**（`HttpError.status`＜500 で判定）。一方 **pageviews API は別ホスト**なので `gate:false` でこのゲートを外し、代わりに `jawikiPageviews.ts` の**専用共有セマフォ（同時6）**で絞る（`PV_CONCURRENCY`）。**初回フル実行は title 解決＋閲覧数取得が大量（各~9万件）で ~90分**かかるが、`state.pages`（title→{qid,photo,正規化タイトル}）と `state.views`（正規化タイトル→閲覧数）にキャッシュされ再実行は速い。どちらのゲート/セマフォも上限を上げると 429 が多発し、その日の people が前回値へフォールバックして網羅性が落ちる（pageviews は 7 並列で既に混入）。
- **取りこぼしの直し方**: `npm run aggregate` 全実行後、`people` が空、または `anniversaries`＋`events` が空の日が出ることがある（レート制限の一過性エラー）。その日付だけ `npx tsx scripts/aggregate.ts <MM-DD ...>` で再実行すれば、成功するまで何度でも上書きできる（成功日は触らない）。年も同様に `npx tsx scripts/aggregateYears.ts <YYYY ...>`。
- **OG画像はコミットしない**。ビルド時に生成して `dist/` にだけ出す。フォントは **43KB のサブセット**を `src/assets/fonts/` に vendoring（Noto Sans JP / SIL OFL 1.1 なので `LICENSE-OFL.txt` を同梱）。**OG画像に人名は入れない**（固定文言だけ）＝字形が限定されるからサブセットで足りる、という設計判断。**`src/lib/og.ts` の文言を変えたら `scripts/buildFontSubset.ts` の `OG_GLYPHS` も必ず更新**（サブセットに無い字は豆腐になる）。※ かつては日別ページ用に366枚生成しており**それだけでビルドが ~2分**かかっていた。日別ページごと廃止したので今は汎用カード1枚だけ。
- **日別ページ `/day/MM-DD` は廃止**（かつては SEO の受け皿として366ページ SSG＋OG画像366枚）。サイトはトップ1ページのみ、canonical は `/`（`?d=` の4万通りをインデックスさせないため）。`@astrojs/sitemap` は導入済み（以前は `public/robots.txt` が存在しない `sitemap-index.xml` を指していて実際に404だった）。
- **誕生日パースの注意**: `jawikiDay.ts` の `parseBirthLine` は「名前、肩書き（+ 没年）」構造を前提に、**末尾の没年注記を先に落としてから最初の読点までを名前**にする（でないと未リンクの人名行で末尾の `[[没年]]` をリンクとして拾い、名前が「2008年」等になる）。`aggregate.ts` の `isYearLike` は年名エントリ除外の保険（現状ほぼ発火しない）。
- **CI は push 時 aggregate をスキップ**（`.github/workflows/update-and-deploy.yml`）: データ再生成は `schedule`（週1）/`workflow_dispatch` のみ。push 時はコミット済みデータでビルドするだけ＝データ bot のコミット→push→再生成 の無限ループ防止。push 時も typecheck/test/build は走る。
- **キャラは 2 系統の静的シード**（どちらも `{name, work, month, day, color?}`）:
  - **curated** `src/data/characters.json`（手描き・少数・色つき）。**ONE PIECE も他作品と同じ 1 ソース**として特別扱いしない。
  - **fanweb バルク** `src/data/characters-fanweb.json`（**コミット済み・~7.5万件/6974作品**）。生成は取込スクリプト `scripts/importFanwebCharacters.ts`（`scripts/sources/fanwebDay.ts` が bd.fan-web.jp の日別ページ `sayhappy_sp.cgi?month=&day=` を `fetchText`＋正規表現でパース、`<font color=crimson><b>名前</b></font>(<a ...search.cgi...>作品</a>)` を抽出）。**aggregate は実行時に第三者サイトへ依存しない**（このコミット済み JSON を読むだけ）。
  - **キャラの取込・反映フロー**: `npm run import:characters`（全366日を再取得→ `characters-fanweb.json` 上書き。`npx tsx scripts/importFanwebCharacters.ts <MM-DD ...>` は当該日のみ・出力のみでファイル未書込＝デバッグ）→ `npm run rank:works`（新しい作品の閲覧数を state に足す。既存作品はキャッシュ済みなので速い）→ `CHARS_ONLY=1 npm run aggregate`（**Wikipedia を叩かず** 既存 per-day ファイルの `characters` だけ差し替え＝全日を数秒で反映。並びは**キャッシュ済みの人気のみ**で決まるので `rank:works` を先に）。通常の `npm run aggregate`（フル再取得）でも同じ `charMap` 経由で反映され、未解決の作品はその場でトップアップされる。
- **キャラ画像（AniList・認証不要）**: かつては「著作権配慮で不掲載」だったが、**リスクを認識した上で AniList の画像を直リンク表示する判断に変更**（2026-07、ユーザー決定）。権利は各権利者に帰属し、フッタに帰属と削除窓口を明記。**問題が起きたら `src/data/anilist.json` を `{"works":{}}` にして `CHARS_ONLY=1 npm run aggregate` を回せば即・全撤去できる**。
  - 取込は `npm run import:char-images`（`scripts/importCharacterImages.ts`）: キャラ名のグローバル検索はノイズが多い（実測: 無関係な人気キャラが返る）ので、**`Media(search:作品名)` → `characters` ページネーション**で作品単位に取り、`scripts/lib/charMatch.ts` で照合する——Media 照合は緩く（包含一致・「シリーズ」除去）、**キャラ名は正規化後の完全一致のみ**（作品内照合なので誤爆源が少ない）。MANGA と ANIME の両エントリからマージ（キャラ集合が違う）。
  - レートは ~28 req/分（AniList の degraded 制限 30 に合わせた 2.1 秒間隔）。作品の人気降順に処理し **10 作品ごとに途中保存＝いつ止めても再実行で続きから**。`CHAR_IMG_WORKS`（既定800）/`CHAR_IMG_RECHECK=1`。全体で1〜2時間かかるので nohup 推奨。
  - キャッシュ `src/data/anilist.json`（コミットする）: `works[作品名] = {title, chars:{キャラ名→画像URL}} | {none:true}`。反映は `buildCharacterMap` が読むだけ（**実行時 API なし**）→ `CHARS_ONLY=1 npm run aggregate`。
  - **カバー範囲はアニメ・漫画のみ**＝表示キャラの4〜5割が上限。サンリオ・シルバニアファミリー・ポップン・多くのゲーム（原神・アークナイツ等）・VTuber は取れず色ドットのまま。画像は `s4.anilist.co` 直リンク（ホットリンク遮断なしを確認済み）で、読み込み失敗時は `onerror` で色ドットに戻る。
- **生成データはコミットする**（`.gitignore` で除外しない）: 初回 push のデプロイは aggregate をスキップするため、コミット済みの `public/data/**` がそのまま公開される＝全日完備が前提。
- **base path**: `astro.config.mjs` の `base:"/samesaengil"`。JS で組む内部リンク・`public/` への fetch は必ず `siteLink()` を通す。CI では `GH_USER` を `github.repository_owner` で上書き。Tailwind v4 の Vite プラグインは型不一致のため `astro.config.mjs` で `any` キャスト。


---

## 補足（親インデックス `../CLAUDE.md` から移行、2026-07-14）

Astro 5, Tailwind v4, TypeScript, GitHub Pages 静的サイト（https://satory074.github.io/samesaengil/）。

生年月日（年も入力）を入れると、その誕生日にまつわる情報——同じ誕生日の**有名人（顔写真つき）**・**フィクションキャラ**（ONE PIECE/鬼滅/呪術など複数作品）・**今日は何の日**（記念日・できごと）・**誕生日プロフィール**（年齢・干支・和暦世代・星座・誕生石・誕生花）——を一覧表示する若者向け・飲み会ネタ用サイト。名前は same 생일(saeng-il)＝同じ誕生日。

```bash
npm install
npm run dev        # http://localhost:4321/samesaengil/
npm run build      # dist/ に静的出力
npm run typecheck  # astro check
npm run test       # smoketest（almanac/share）+ domtest（jsdom）
npm run aggregate         # 全366日のデータ生成
npm run aggregate 03-15   # 指定日のみ（デバッグ）
```

**アーキテクチャ**: `scripts/aggregate.ts`（todayai パターン）が366日ぶんを `public/data/days/MM-DD.json` に生成・コミット。クライアント（`src/app/main.ts`＝kisei流の boot/data-action/`?d=YYYY-MM-DD` 共有）は入力日の1ファイルだけ fetch し、暦計算（星座・年齢・干支・和暦）は `src/lib/almanac.ts` の純関数でブラウザ側実行。GitHub Actions（週1 cron）が再生成→コミット→Pages デプロイ（push 時は集約スキップ＝ループ防止）。

**データソース（SPARQLは不採用＝公開WDQSは月日FILTERで60秒タイムアウト）**:
- 有名人（**日本語版Wikipediaのみ**）: 日本語版Wikipedia「M月D日」の **`誕生日`節**を `action=parse&prop=wikitext` でパース（~150〜220人/日、日本語肩書き付き）。`人物以外（動物など）`は別途 `animals`。`sources/jawikiDay.ts`（英語版 births マージは廃止）
- 顔写真＋正規化タイトル: 上のjawikiタイトルを `action=query&prop=pageimages|pageprops`（redirects追従）で一括解決し、写真＋**リダイレクト解決後の正規化タイトル**（＋Q-ID）を得る。`sources/jawikiPageMeta.ts`
- 人気（並び替え指標＝閲覧数）: **日本語版Wikipediaの年間閲覧数**（Wikimedia REST **pageviews API**、別ホスト）。`sources/jawikiPageviews.ts`。人物は増やさず並び順にだけ使う。並びは 閲覧数降順→写真→生年新しい順、**全件保存**し表示は先頭30＋もっと見る（遅延描画）。**metrics APIは1IP~6並列で429**のため日並列と無関係に総同時実行6の共有セマフォで絞る（`gate:false`）。旧Wikidata sitelink方式（世界的知名度で米大統領等が上位に来てズレる）は廃止
- 今日は何の日: 同じ `fetchDayInfo`（**節indexはページ毎に違うので section一覧から名前で引く**）
- キャラ: 手動JSON `src/data/characters.json`＋fanwebバルク（名前＋作品名＋色チップ。**アニメ・漫画キャラは AniList 画像つき**＝`src/data/anilist.json`）
- 占い/暦: `src/lib/almanac.ts` で計算（API不要）

**Gotcha**: 人物は日本語版由来なので肩書きは初めから日本語（旧・英語版マージ＋翻訳は廃止）。キャッシュ/失敗フォールバックは `src/data/state.json`（`pages`＋`views`）＋前回per-dayファイル。`color-scheme: light dark` 宣言＋ `prefers-color-scheme: dark` の正規ダークテーマで自動ダークモード対策（ただし Chrome の force-dark フラグ有効環境はCSSから抑止不可＝paint層で強制）。Tailwind v4 + Astro 型不一致は `astro.config.mjs` で `any` キャスト、`base: "/samesaengil"`。`src/app/*`・`src/lib/*` は tsx テストのため**相対import**（@エイリアス不可）。
