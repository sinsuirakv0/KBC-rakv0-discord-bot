import { SaleEntry, SaleHeader, SaleJson, TimeBlock } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Invalid sale data: ${key} must be a string`);
  }
  return value;
}

function parseHeader(value: unknown): SaleHeader {
  if (!isRecord(value)) {
    throw new Error("Invalid sale data: header must be an object");
  }
  return {
    startDate: requireString(value, "startDate"),
    startTime: requireString(value, "startTime"),
    endDate: requireString(value, "endDate"),
    endTime: requireString(value, "endTime"),
    minVersion: requireString(value, "minVersion"),
    maxVersion: requireString(value, "maxVersion"),
  };
}

function parseStringArray(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid sale data: ${key} must be a string array`);
  }
  return value;
}

function parseNumberArray(value: unknown, key: string): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "number" || !Number.isInteger(item))
  ) {
    throw new Error(`Invalid sale data: ${key} must be an integer array`);
  }
  return value;
}

function parseTimeBlock(value: unknown): TimeBlock {
  if (!isRecord(value)) {
    throw new Error("Invalid sale data: time block must be an object");
  }
  if (!Array.isArray(value.dateRanges)) {
    throw new Error("Invalid sale data: dateRanges must be an array");
  }
  const dateRanges = value.dateRanges.map((range) => {
    if (!isRecord(range)) {
      throw new Error("Invalid sale data: date range must be an object");
    }
    return {
      start: requireString(range, "start"),
      end: requireString(range, "end"),
    };
  });
  if (!Array.isArray(value.timeRanges)) {
    throw new Error("Invalid sale data: timeRanges must be an array");
  }
  const timeRanges = value.timeRanges.map((range) => {
    if (
      !Array.isArray(range) ||
      range.length < 2 ||
      typeof range[0] !== "string" ||
      typeof range[1] !== "string"
    ) {
      throw new Error("Invalid sale data: time range must contain two strings");
    }
    return [range[0], range[1]] as const;
  });
  return {
    dateRanges,
    monthDays: parseNumberArray(value.monthDays, "monthDays"),
    weekdays: parseStringArray(value.weekdays, "weekdays"),
    timeRanges,
  };
}

function parseEntry(value: unknown): SaleEntry {
  if (!isRecord(value)) {
    throw new Error("Invalid sale data: entry must be an object");
  }
  if (!Array.isArray(value.timeBlocks)) {
    throw new Error("Invalid sale data: timeBlocks must be an array");
  }
  if (value.raw !== undefined && typeof value.raw !== "string") {
    throw new Error("Invalid sale data: raw must be a string");
  }
  return {
    header: parseHeader(value.header),
    timeBlocks: value.timeBlocks.map(parseTimeBlock),
    stageIds: parseNumberArray(value.stageIds, "stageIds"),
    ...(typeof value.raw === "string" ? { raw: value.raw } : {}),
  };
}

export function parseSaleJson(value: unknown): SaleJson {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid sale data: root data must be an array");
  }
  return {
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    data: value.data.map(parseEntry),
  };
}

export function parseIdNameCsv(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) continue;
    const id = Number.parseInt(line.slice(0, commaIndex).trim(), 10);
    const name = line.slice(commaIndex + 1).trim();
    if (Number.isInteger(id) && name) names.set(id, name);
  }
  return names;
}

export function parseAllDayEventTsv(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const cells = line.split("\t");
    if (cells.length < 2) continue;
    const name = cells[0].trim();
    const id = Number(cells[1].trim());
    if (name && Number.isInteger(id)) names.set(id, name);
  }
  return names;
}

export function parseCardSetting(text: string): readonly number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").replace(/\/\/.*/, "").trim();
    if (!line) continue;
    for (const rawToken of line.split(/[,\s]+/)) {
      const token = rawToken.trim();
      if (!token) continue;
      const id = Number(token);
      if (!Number.isInteger(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
