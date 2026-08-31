// 前回入力した生年月日の永続化（localStorage）。?d= が無いロード時にフォームへ復元する
// （入力のみ・診断はしない＝main.ts 側の判断）。private mode 等では localStorage への
// **アクセス自体**が throw しうるので読み書きとも try/catch。tsx 直実行（テスト）では
// globalThis.localStorage が未定義なので optional chaining で素通りさせる。
import { type BirthInput, decodeDate, encodeDate } from "./share";

const KEY = "samesaengil:lastInput";

/** 保存済みの前回値。無い・壊れている・読めない環境なら null。 */
export function loadLastInput(): BirthInput | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? decodeDate(raw) : null;
  } catch {
    return null;
  }
}

/** 診断に使った（＝検証済みの）生年月日を保存。保存できない環境では何もしない。 */
export function saveLastInput(v: BirthInput): void {
  try {
    globalThis.localStorage?.setItem(KEY, encodeDate(v));
  } catch {
    /* private mode 等は無視 */
  }
}
