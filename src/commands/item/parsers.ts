import {
  ItemEntry,
  ItemHeader,
  ItemJson,
  ItemName,
  ItemTimeBlock,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Invalid item data: ${key} must be a string`);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid item data: ${key} must be an integer`);
  }
  return value;
}

function requireDate(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`Invalid item data: ${key} must be an 8-digit date`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid item data: ${key} is not a valid date`);
  }
  return value;
}

function requireTime(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!/^\d{1,4}$/.test(value)) {
    throw new Error(`Invalid item data: ${key} must be a numeric time`);
  }
  const padded = value.padStart(4, "0");
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid item data: ${key} is not a valid time`);
  }
  return value;
}

function parseHeader(value: unknown): ItemHeader {
  if (!isRecord(value)) throw new Error("Invalid item data: header must be an object");
  return {
    startDate: requireDate(value, "startDate"),
    startTime: requireTime(value, "startTime"),
    endDate: requireDate(value, "endDate"),
    endTime: requireTime(value, "endTime"),
    minVersion: requireString(value, "minVersion"),
    maxVersion: requireString(value, "maxVersion"),
  };
}

function parseStringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid item data: ${key} must be a string array`);
  }
  return value;
}

function parseIntegerArray(value: unknown, key: string): readonly number[] {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item))) {
    throw new Error(`Invalid item data: ${key} must be an integer array`);
  }
  return value as number[];
}

function parseTimeBlock(value: unknown): ItemTimeBlock {
  if (!isRecord(value)) {
    throw new Error("Invalid item data: time block must be an object");
  }
  if (!Array.isArray(value.dateRanges)) {
    throw new Error("Invalid item data: dateRanges must be an array");
  }
  const dateRanges = value.dateRanges.map((range) => {
    if (!isRecord(range)) {
      throw new Error("Invalid item data: date range must be an object");
    }
    return {
      start: requireString(range, "start"),
      end: requireString(range, "end"),
    };
  });
  if (!Array.isArray(value.timeRanges)) {
    throw new Error("Invalid item data: timeRanges must be an array");
  }
  const timeRanges = value.timeRanges.map((range) => {
    if (
      !Array.isArray(range) ||
      range.length < 2 ||
      typeof range[0] !== "string" ||
      typeof range[1] !== "string"
    ) {
      throw new Error("Invalid item data: time range must contain two strings");
    }
    return [range[0], range[1]] as const;
  });
  return {
    dateRanges,
    monthDays: parseIntegerArray(value.monthDays, "monthDays"),
    weekdays: parseStringArray(value.weekdays, "weekdays"),
    timeRanges,
  };
}

function parseEntry(value: unknown): ItemEntry {
  if (!isRecord(value) || !isRecord(value.gift)) {
    throw new Error("Invalid item data: entry and gift must be objects");
  }
  if (!Array.isArray(value.timeBlocks)) {
    throw new Error("Invalid item data: timeBlocks must be an array");
  }
  if (value.raw !== undefined && typeof value.raw !== "string") {
    throw new Error("Invalid item data: raw must be a string");
  }
  return {
    header: parseHeader(value.header),
    timeBlocks: value.timeBlocks.map(parseTimeBlock),
    gift: {
      eventId: requireInteger(value.gift, "eventId"),
      giftType: requireInteger(value.gift, "giftType"),
      giftAmount: requireInteger(value.gift, "giftAmount"),
      title: requireString(value.gift, "title"),
      message: requireString(value.gift, "message"),
      url: requireString(value.gift, "url"),
      repeatFlag: requireInteger(value.gift, "repeatFlag"),
    },
    ...(typeof value.raw === "string" ? { raw: value.raw } : {}),
  };
}

export function parseItemJson(value: unknown): ItemJson {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid item data: root data must be an array");
  }
  return {
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    data: value.data.map(parseEntry),
  };
}

export function parseItemNameCsv(text: string): Map<number, ItemName> {
  const names = new Map<number, ItemName>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line.trim()) continue;
    const cells = line.split(",");
    if (cells.length < 2) continue;
    const id = Number(cells[0].trim());
    const name = cells[1].trim();
    if (!Number.isInteger(id) || !name) continue;
    names.set(id, { name, detail: cells.slice(2).join(",").trim() });
  }
  if (names.size === 0) throw new Error("Invalid item name CSV: no valid entries");
  return names;
}

export function parseIdNameCsv(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) continue;
    const id = Number(line.slice(0, commaIndex).trim());
    const name = line.slice(commaIndex + 1).trim();
    if (Number.isInteger(id) && name) names.set(id, name);
  }
  if (names.size === 0) throw new Error("Invalid item sale-name CSV: no valid entries");
  return names;
}
