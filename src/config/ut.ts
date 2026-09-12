export interface UtDataUrls {
  characterIndex: string;
  characterAssets: string;
  unitBuy: string;
  siteDataBase: string;
}

const siteDataBase =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata";

export const utDataUrls: UtDataUrls = {
  characterIndex: `${siteDataBase}/character-index.json`,
  characterAssets: `${siteDataBase}/character-assets.json`,
  unitBuy: `${siteDataBase}/Data/unitbuy.csv`,
  siteDataBase,
};

export const utSearchPageUrl =
  "https://jarjarblink.github.io/JDB/unit_search.html?cc=ja";
export const utDetailPageBaseUrl = "https://jarjarblink.github.io/JDB";
export const utCacheTtlMs = 10 * 60 * 1_000;
export const utHttpTimeoutMs = 10_000;
export const utMotionRenderTimeoutMs = 10 * 60_000;
export const utMotionStallTimeoutMs = 60_000;
export const utMotionFrameRate = 30;
export const utMotionMaxPixels = 640 * 480;
export const utMotionVideoMaxPixels = 480 * 400;
export const utMotionMaxDimension = 960;
export const utMotionPngPixelRatio = 4;
export const utMotionPaletteSampleCount = 16;
export const utMotionPaletteSampleSize = 128;
export const utMotionPadding = 8;
export const utMotionViewportSideMargin = 1;
export const utMotionViewportTopMargin = 0.35;
export const utMotionViewportBottomMargin = 0.1;
export const utMotionProgressIntervalMs = 2_000;
export const utReactionTimeoutMs = 60_000;
export const utPageSize = 20;
