import {
  ItemDisplayData,
  ItemEntry,
  ItemJson,
  ItemRequest,
  ItemSearchResult,
} from "./types";

const GATYA_LINKED_GIFT_TYPES = new Set([301, 302]);

function parseId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function parseItemRequest(args: readonly string[]): ItemRequest {
  if (args.length === 0) return { kind: "schedule" };
  if (args.length === 1) {
    const id = parseId(args[0]);
    return id === undefined ? { kind: "usage" } : { kind: "detail", id };
  }
  if (args.length === 2) {
    const id = parseId(args[0]);
    if (id === undefined) return { kind: "usage" };
    const modifier = args[1].toLowerCase();
    if (modifier === "j" || modifier === "json") return { kind: "json", id };
    if (modifier === "r" || modifier === "raw") return { kind: "raw", id };
  }
  return { kind: "usage" };
}

export function searchItemEntries(id: number, item: ItemJson): ItemSearchResult {
  const giftTypeEntries = item.data.filter((entry) => entry.gift.giftType === id);
  if (giftTypeEntries.length > 0) {
    return { entries: giftTypeEntries, searchedByEventId: false };
  }
  return {
    entries: item.data.filter((entry) => entry.gift.eventId === id),
    searchedByEventId: true,
  };
}

export function getItemScheduleName(
  entry: ItemEntry,
  data: ItemDisplayData,
): string {
  const giftType = entry.gift.giftType;
  if (GATYA_LINKED_GIFT_TYPES.has(giftType)) {
    return data.saleNames.get(giftType) ||
      data.itemNames.get(giftType)?.name ||
      entry.gift.title.trim() ||
      "不明";
  }
  return entry.gift.title.trim() || data.itemNames.get(giftType)?.name || "不明";
}

export function getItemDetailName(
  giftType: number,
  data: ItemDisplayData,
): string {
  return data.itemNames.get(giftType)?.name ?? "不明";
}

export function isPermanentItem(entry: ItemEntry): boolean {
  return entry.header.endDate === "20300101";
}
