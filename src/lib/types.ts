// samesaengil のデータ型（ビルドスクリプトとクライアントで共有）。

/** 同じ誕生日の実在の有名人（Wikipedia births + Wikidata 由来）。 */
export interface Person {
  /** 日本語名（無ければ英語名）。 */
  name: string;
  /** 英語名（イニシャルアバター用にも使う）。 */
  nameEn: string;
  /** 生年（西暦）。年齢計算に使う。 */
  year: number;
  /** ひとことプロフィール（日本語優先、無ければ英語）。 */
  desc: string;
  /** 顔写真 URL（Wikimedia Commons 直リンク）。無ければ空文字。 */
  photo: string;
  /** Wikipedia 記事 URL。 */
  url: string;
  /** 日本語版 Wikipedia に記事がある（＝日本でも知られている）か。 */
  jaKnown: boolean;
  /** 知名度の代理指標（Wikidata の sitelink 数）。並び替え用。 */
  fame: number;
}

/** 同じ誕生日のフィクションキャラ（複数作品横断・画像なし）。 */
export interface Character {
  name: string;
  /** 作品名（例: "ONE PIECE"）。 */
  work: string;
  /** 公式/出典 URL（任意）。 */
  url?: string;
  /** 色チップの色（任意、#rrggbb）。 */
  color?: string;
}

/** 記念日・年中行事（その月日の）。 */
export interface Anniversary {
  label: string;
  desc?: string;
}

/** その月日のできごと（歴史）。 */
export interface DayEvent {
  year: number;
  text: string;
}

/** 1 日ぶんの集約データ（public/data/days/MM-DD.json）。 */
export interface DayData {
  /** "MM-DD"。 */
  date: string;
  people: Person[];
  characters: Character[];
  anniversaries: Anniversary[];
  events: DayEvent[];
  /** 生成時刻（ISO）。 */
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
