export interface ItemHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
}

export interface ItemDateRange {
  start: string;
  end: string;
}

export interface ItemTimeBlock {
  dateRanges: readonly ItemDateRange[];
  monthDays: readonly number[];
  weekdays: readonly string[];
  timeRanges: readonly (readonly [string, string])[];
}

export interface ItemGift {
  eventId: number;
  giftType: number;
  giftAmount: number;
  title: string;
  message: string;
  url: string;
  repeatFlag: number;
}

export interface ItemEntry {
  header: ItemHeader;
  timeBlocks: readonly ItemTimeBlock[];
  gift: ItemGift;
  raw?: string;
}

export interface ItemJson {
  updatedAt: string;
  data: readonly ItemEntry[];
}

export interface ItemName {
  name: string;
  detail: string;
}

export interface ItemDisplayData {
  item: ItemJson;
  itemNames: ReadonlyMap<number, ItemName>;
  saleNames: ReadonlyMap<number, string>;
}

export interface ItemDataSource {
  fetchItemJson(): Promise<ItemJson>;
  fetchDisplayData(): Promise<ItemDisplayData>;
}

export type ItemRequest =
  | { kind: "schedule" }
  | { kind: "detail"; id: number }
  | { kind: "json"; id: number }
  | { kind: "raw"; id: number }
  | { kind: "usage" };

export interface ItemSearchResult {
  entries: readonly ItemEntry[];
  searchedByEventId: boolean;
}
