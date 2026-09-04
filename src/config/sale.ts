export interface SaleDataUrls {
  saleJson: string;
  saleNames: string;
  allDayEventNames: string;
  missionNames: string;
  cardSetting: string;
}

export const saleDataUrls: SaleDataUrls = {
  saleJson:
    "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale.json",
  saleNames:
    "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale_name.csv",
  allDayEventNames:
    "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata/res/All_day_event.tsv",
  missionNames:
    "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-assets/main/jp/sitedata/res/Mission_Name.csv",
  cardSetting:
    "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/setting/cardsetting",
};

export const saleHttpTimeoutMs = 10_000;
