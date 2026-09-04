export interface ItemDataUrls {
  itemJson: string;
  itemNames: string;
  saleNames: string;
}

const eventDataBaseUrl =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data";

export const itemDataUrls: ItemDataUrls = {
  itemJson: `${eventDataBaseUrl}/item.json`,
  itemNames: `${eventDataBaseUrl}/item_name.csv`,
  saleNames: `${eventDataBaseUrl}/sale_name.csv`,
};

export const itemHttpTimeoutMs = 10_000;
