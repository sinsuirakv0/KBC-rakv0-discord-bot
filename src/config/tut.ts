export interface TutDataUrls {
  enemyNames: string;
  aliases: string;
  enemyIconsBase: string;
}

const siteDataBase =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata";

export const tutDataUrls: TutDataUrls = {
  enemyNames: `${siteDataBase}/res/Enemyname.tsv`,
  aliases:
    "https://raw.githubusercontent.com/Sugar2550/omoroirie/main/data/enemyname.json",
  enemyIconsBase: `${siteDataBase}/Image`,
};

export const tutSearchPageUrl =
  "https://jarjarblink.github.io/JDB/tunit_search.html?cc=ja";
export const tutDetailPageUrl =
  "https://jarjarblink.github.io/JDB/t000.html?cc=ja";
export const tutCacheTtlMs = 10 * 60 * 1_000;
export const tutHttpTimeoutMs = 10_000;
export const tutReactionTimeoutMs = 60_000;
export const tutPageSize = 20;
