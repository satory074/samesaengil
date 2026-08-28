// samesaengil のデータ型（ビルドスクリプトとクライアントで共有）。

/** 同じ誕生日の実在の有名人（日本語版Wikipedia「M月D日」の誕生日節に載っている人）。 */
export interface Person {
  /** 日本語名。 */
  name: string;
  /** 英語名（イニシャルアバター用）。日本語版のみを使う現在は常に空文字。 */
  nameEn: string;
  /** 生年（西暦）。年齢計算に使う。0 は生年非公表/不詳。 */
  year: number;
  /** ひとことプロフィール（日本語の肩書き）。 */
  desc: string;
  /**
   * 顔写真 URL。無ければ空文字（一覧の約4割。日本語版Wikipedia は存命の日本人の自由ライセンス写真が乏しい）。
   * 出所は jawiki の pageimages が最優先で、無ければ TMDB / Wikidata P18 / Spotify（scripts/sources/photos.ts）。
   */
  photo: string;
  /** Wikipedia 記事 URL。 */
  url: string;
  /** 日本語版 Wikipedia に記事がある（＝日本でも知られている）か。 */
  jaKnown: boolean;
  /** 人気の指標（日本語版Wikipedia の直近12か月の閲覧数）。並び替え用。 */
  fame: number;
}

/** 同じ誕生日のフィクションキャラ（複数作品横断）。 */
export interface Character {
  name: string;
  /** 作品名（例: "ONE PIECE"）。 */
  work: string;
  /** 公式/出典 URL（任意）。 */
  url?: string;
  /** 色チップの色（任意、#rrggbb）。画像が無い/読めないキャラの表示に使う。 */
  color?: string;
  /**
   * キャラ画像 URL（任意、AniList 直リンク）。アニメ・漫画のキャラのみ（ゲーム・サンリオ・
   * VTuber 等は付かない）。取込は scripts/importCharacterImages.ts → src/data/anilist.json。
   */
  image?: string;
}

/** 記念日・年中行事（その月日の）。 */
export interface Anniversary {
  label: string;
  desc?: string;
  /** 由来ページ URL（日本記念日協会由来のみ。Wikipedia 由来は常に欠落）。 */
  url?: string;
}

/** その月日のできごと（歴史）。 */
export interface DayEvent {
  year: number;
  text: string;
}

/**
 * その月日に発売されたゲームソフト。
 * 出所は日本語版Wikipedia の機種別「〈機種〉のゲームタイトル一覧」（家庭用機・携帯機）と、
 * Steam 公式ストア（PC）。取込は scripts/importGames.ts → src/data/games.json。
 */
export interface Game {
  /** 表示名。 */
  name: string;
  /** 発売年。月日は per-day ファイル名で決まるので持たない（Person と同じ流儀）。 */
  year: number;
  /** 機種。同じ日に同名が複数機種で出ていれば "PS5・Switch" のように連結。Steam 由来は "Steam"。 */
  platform: string;
  /**
   * jawiki 記事タイトル。一覧で未リンクだったソフト（全体の 12%）は欠落。
   * **URL ではなくタイトルで持つ**——日本語タイトルの %エンコード済み URL は 1 件あたり 100 バイト超で、
   * 1日 最大 340 本ぶんを持つと診断のたびに fetch する per-day ファイルが倍近く膨らむ。
   * 表示側は src/lib/games.ts の gameLink() で組み立てる。
   */
  title?: string;
  /** Steam の appid（Steam 由来のみ）。URL は同じく gameLink() で組み立てる。 */
  appid?: number;
}

/** 1 日ぶんの集約データ（public/data/days/MM-DD.json）。 */
export interface DayData {
  /** "MM-DD"。 */
  date: string;
  people: Person[];
  /** 同じ誕生日の動物（名馬など。日本語版 Wikipedia「人物以外」節由来）。Person 形を流用。 */
  animals: Person[];
  characters: Character[];
  anniversaries: Anniversary[];
  /**
   * 日本記念日協会（kinenbi.gr.jp）の認定記念日。anniversaries（Wikipedia 由来）とは
   * 別キーで持ち、表示時に src/lib/anniv.ts でマージする。マージ済みを焼き込むと
   * KINENBI_ONLY 高速パスの再実行で由来の判別が必要になり冪等でなくなるため。
   */
  kinenbi: Anniversary[];
  events: DayEvent[];
  /** 生成時刻（ISO）。 */
  updatedAt: string;
  /**
   * その月日に発売されたゲームソフト（全年ぶん）。人気順（jawiki の年間閲覧数）→ 年の新しい順。
   * kinenbi と同じく「コミット済み JSON（src/data/games.json）を読むだけ」の系統で、
   * GAMES_ONLY=1 の高速パスで差し替えられる。
   */
  games: Game[];
}

/** その年のできごと（日付つき）。 */
export interface YearEvent {
  month: number;
  day: number;
  text: string;
}

/** オリコン週間シングルチャート第1位（1週ぶん）。 */
export interface ChartWeek {
  /** 集計発表日（この日付の週の1位）。 */
  month: number;
  day: number;
  title: string;
  artist: string;
  /** jawiki の曲記事 URL（無ければ空文字）。 */
  url: string;
  /** Spotify の曲ページ URL。未解決/Spotify 未収録なら欠落（表示側は検索 URL にフォールバック）。 */
  spotify?: string;
  /** Spotify のアルバムジャケット（~300px）。未解決なら欠落（表示側はプレースホルダ）。 */
  cover?: string;
}

/**
 * 同じ学年に生まれた有名人（日別データを学年＝年度で逆引きしたもの）。
 * 生成は scripts/aggregateYears.ts。Person より痩せているのは、年 JSON が
 * 毎回 fetch されるホットパスだから（nameEn/jaKnown は使わない、fame は並びに畳み込み済み）。
 */
export interface YearPerson {
  name: string;
  /**
   * 生年月日。学年は暦年をまたぐ（1995年度 = 1995/4/2〜1996/4/1）ので、
   * 表示にも年が要る（「1996/2/10生まれ」＝早生まれだと分かる）。
   */
  year: number;
  month: number;
  day: number;
  /** 肩書き（表示のほか、カテゴリ分類の入力でもある。src/lib/peers.ts）。 */
  desc: string;
  photo: string;
  url: string;
}

/** 1 年ぶんの集約データ（public/data/years/YYYY.json）。 */
export interface YearData {
  year: number;
  /** 日付つきできごと（全月）。 */
  events: YearEvent[];
  /** 「主な出来事」節（あれば）。 */
  highlights: string[];
  /** その年のオリコン週間1位。1968年より前・テンプレ欠損は []。 */
  chartWeeks: ChartWeek[];
  /** 前年の最終週の1位（年始生まれが「生まれた週の1位」を引けるように）。 */
  prevYearLast: ChartWeek | null;
  /**
   * **この年を年度とする学年**（YYYY/4/2 〜 YYYY+1/4/1 生まれ）の有名人。人気順・カテゴリごとに上限つき。
   * events/chartWeeks が「暦年 YYYY」なのに対し、people だけ**年度**であることに注意
   * （日本の「同い年」＝同学年なので）。早生まれの人はこのファイルではなく前年のファイルを引く。
   */
  people: YearPerson[];
  updatedAt: string;
}

/** 静的キャラ JSON（src/data/characters.json）の 1 件。 */
export interface CharacterSeed {
  name: string;
  work: string;
  month: number;
  day: number;
  url?: string;
  color?: string;
}
