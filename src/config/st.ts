export interface StDataUrls {
  stageTypes: string;
  mapNames: string;
  saleNames: string;
  normalStageBase: string;
  chapterStageBase: string;
}

const assetResourceBase =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata/res";
const eventDataBase =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data";

export const stDataUrls: StDataUrls = {
  stageTypes: `${eventDataBase}/stage_type.csv`,
  mapNames: `${assetResourceBase}/Map_Name.csv`,
  saleNames: `${eventDataBase}/sale_name.csv`,
  normalStageBase: assetResourceBase,
  chapterStageBase:
    "https://raw.githubusercontent.com/Sugar2550/omoroirie/main/data",
};

export const stSearchPageUrl =
  "https://jarjarblink.github.io/JDB/map_search.html?cc=ja";
export const stDetailPageBaseUrl = "https://jarjarblink.github.io/JDB/map.html";
export const stCacheTtlMs = 10 * 60 * 1_000;
export const stHttpTimeoutMs = 10_000;
export const stReactionTimeoutMs = 60_000;
export const stPageSize = 20;
