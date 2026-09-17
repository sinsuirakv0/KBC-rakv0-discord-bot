export interface UtDataUrls {
  characterIndex: string;
  unitBuy: string;
  siteDataBase: string;
}

const siteDataBase =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata";

export const utDataUrls: UtDataUrls = {
  characterIndex: `${siteDataBase}/character-index.json`,
  unitBuy: `${siteDataBase}/Data/unitbuy.csv`,
  siteDataBase,
};

export const utSearchPageUrl =
  "https://jarjarblink.github.io/JDB/unit_search.html?cc=ja";
export const utDetailPageBaseUrl = "https://jarjarblink.github.io/JDB";
export const utCacheTtlMs = 10 * 60 * 1_000;
export const utHttpTimeoutMs = 10_000;
export {
  motionRenderTimeoutMs as utMotionRenderTimeoutMs,
  motionStallTimeoutMs as utMotionStallTimeoutMs,
  motionFrameRate as utMotionFrameRate,
  motionMaxPixels as utMotionMaxPixels,
  motionVideoMaxPixels as utMotionVideoMaxPixels,
  motionMaxDimension as utMotionMaxDimension,
  motionPngPixelRatio as utMotionPngPixelRatio,
  motionPaletteSampleCount as utMotionPaletteSampleCount,
  motionPaletteSampleSize as utMotionPaletteSampleSize,
  motionPadding as utMotionPadding,
  motionViewportSideMargin as utMotionViewportSideMargin,
  motionViewportTopMargin as utMotionViewportTopMargin,
  motionViewportBottomMargin as utMotionViewportBottomMargin,
  motionProgressIntervalMs as utMotionProgressIntervalMs,
} from "./motion";
export const utReactionTimeoutMs = 60_000;
export const utPageSize = 20;
