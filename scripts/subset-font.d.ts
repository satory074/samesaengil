// subset-font は型定義を同梱していないので最小限の宣言を置く（astro check が ts(7016) で落ちる）。
declare module "subset-font" {
  interface SubsetOptions {
    targetFormat?: "sfnt" | "woff" | "woff2" | "truetype";
    /** 可変フォントの軸を固定する（例: { wght: 700 }）。 */
    variationAxes?: Record<string, number>;
  }
  export default function subsetFont(font: Buffer, text: string, options?: SubsetOptions): Promise<Buffer>;
}
