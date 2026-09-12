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
export const utMotionRenderTimeoutMs = 60_000;
export const utMotionFrameRate = 30;
export const utMotionWidth = 640;
export const utMotionHeight = 480;
export const utMotionProgressIntervalMs = 2_000;
export const utReactionTimeoutMs = 60_000;
export const utPageSize = 20;
