# samesaengil 🎂

生年月日を入れると「同じ誕生日のあれこれ」が出てくる、若者向け・飲み会ネタ用の静的サイト。
名前は **same 생일(saeng-il)** ＝「同じ誕生日」。

公開URL: https://satory074.github.io/samesaengil/

入力した生年月日（年も使う）から、その誕生日にまつわる情報をまとめて表示します。

- 🎤 **同じ誕生日の有名人**（顔写真つき・日本で有名な人を優先。動物・名馬も同じグリッド）
- 🦸 **同じ誕生日のキャラ**（アニメ・漫画・ゲームなど。アニメ/漫画は画像つき）
- 📅 **M月D日は何の日**（記念日・できごと）
- 🎂 **生まれた年**（その年のできごと＋生まれた週のオリコン1位）
- 🎮 **同じ誕生日に発売されたゲーム**（生まれた日ちょうどの分は⭐）
- 📺 **同じ誕生日に投稿されたニコニコ動画**（100万再生以上のミリオン動画だけ。⭐ 同上）
- ✨ **誕生日プロフィール**（年齢・干支・和暦世代・星座・誕生石・誕生花・曜日・月齢・数秘・九星）
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
| 有名人＋顔写真 | 日本語版 Wikipedia「M月D日」の誕生日節 | Action API（名前・生年・日本語の肩書き＋ pageimages の顔写真） |
| 並び順（人気） | Wikimedia pageviews API | 記事の直近12か月の閲覧数（人物を増やさず並びにだけ使う） |
| M月D日は何の日 | 日本語版 Wikipedia「M月D日」＋日本記念日協会 | Action API ／ kinenbi.gr.jp（取込 → `src/data/kinenbi.json`） |
| キャラ | `src/data/characters.json` ＋ bd.fan-web.jp バルク | 静的JSON（アニメ・漫画は AniList の画像つき） |
| 生まれた年 | 日本語版 Wikipedia「YYYY年」＋オリコン週間1位 | Action API（曲は Spotify でリンク・ジャケを解決） |
| 発売されたゲーム | 機種別「ゲームタイトル一覧」31機種＋Steam | 取込 → `src/data/games.json`（ジャケは IGDB） |
| ニコニコ動画（ミリオン） | ニコニコ動画 スナップショット検索API v2 | 年ごとに全件取得 → `src/data/nicovideos.json`（キー不要） |
| 星座・誕生石・誕生花・干支・和暦 | `src/lib/almanac.ts` | 月日・年から計算（API不要） |

キャッシュ・失敗時フォールバックは `src/data/state.json` と前回の per-day ファイルで担保。

## キャラの追加（手動JSON）

`src/data/characters.json` に `{ name, work, month, day, color? }` を足すだけ。
公式設定の誕生日を、若者が知っている作品を中心に拡張していく想定（`lastcall` と同じ手動運用）。

## 著作権・クレジット

- 有名人の顔写真は Wikimedia Commons（自由ライセンス）から直リンク。各カードは出典記事へリンク。
- フィクションキャラの画像は AniList、ゲームのジャケットは IGDB / Steam、ミリオン動画のサムネイルは
  ニコニコ動画から直リンク。権利は各権利者に帰属します（掲載に問題がある場合はお知らせください、すみやかに削除します）。

## ライセンス / 注意

誕生日を知るための非公式・趣味サイト。データは各出典に帰属。
