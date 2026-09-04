import {
  GachaBlock,
  GachaEntry,
  GachaHeader,
  GachaJson,
  GachaRate,
  ItemScheduleEntry,
  ItemScheduleJson,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Invalid gatya data: ${key} must be a string`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid gatya data: ${key} must be a number`);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string): number {
  const value = requireNumber(record, key);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid gatya data: ${key} must be an integer`);
  }
  return value;
}

function parseRate(value: unknown): GachaRate {
  if (!isRecord(value)) throw new Error("Invalid gatya data: rates must be an object");
  return {
    normal: requireNumber(value, "normal"),
    rare: requireNumber(value, "rare"),
    superRare: requireNumber(value, "superRare"),
    uberRare: requireNumber(value, "uberRare"),
    legendRare: requireNumber(value, "legendRare"),
  };
}

function parseEntry(value: unknown): GachaEntry {
  if (!isRecord(value)) throw new Error("Invalid gatya data: gacha must be an object");
  if (typeof value.guaranteed !== "boolean") {
    throw new Error("Invalid gatya data: guaranteed must be a boolean");
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    throw new Error("Invalid gatya data: message must be a string");
  }
  return {
    id: requireNumber(value, "id"),
    price: requireNumber(value, "price"),
    flags: requireNumber(value, "flags"),
    rates: parseRate(value.rates),
    guaranteed: value.guaranteed,
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function parseHeader(value: unknown): GachaHeader {
  if (!isRecord(value)) throw new Error("Invalid gatya data: header must be an object");
  return {
    startDate: requireString(value, "startDate"),
    startTime: requireString(value, "startTime"),
    endDate: requireString(value, "endDate"),
    endTime: requireString(value, "endTime"),
    minVersion: requireString(value, "minVersion"),
    maxVersion: requireString(value, "maxVersion"),
    gachaType: requireNumber(value, "gachaType"),
    gachaCount: requireNumber(value, "gachaCount"),
  };
}

function parseBlock(value: unknown): GachaBlock {
  if (!isRecord(value) || !Array.isArray(value.gachas)) {
    throw new Error("Invalid gatya data: block gachas must be an array");
  }
  if (value.raw !== undefined && typeof value.raw !== "string") {
    throw new Error("Invalid gatya data: raw must be a string");
  }
  return {
    header: parseHeader(value.header),
    gachas: value.gachas.map(parseEntry),
    ...(typeof value.raw === "string" ? { raw: value.raw } : {}),
  };
}

export function parseGachaJson(value: unknown): GachaJson {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid gatya data: root data must be an array");
  }
  return {
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    data: value.data.map(parseBlock),
  };
}

function parseItemEntry(value: unknown): ItemScheduleEntry {
  if (!isRecord(value) || !isRecord(value.header) || !isRecord(value.gift)) {
    throw new Error("Invalid gatya item data: entry, header, and gift must be objects");
  }
  return {
    header: {
      startDate: requireString(value.header, "startDate"),
      startTime: requireString(value.header, "startTime"),
      endDate: requireString(value.header, "endDate"),
      endTime: requireString(value.header, "endTime"),
    },
    gift: {
      giftType: requireInteger(value.gift, "giftType"),
    },
  };
}

export function parseItemScheduleJson(value: unknown): ItemScheduleJson {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid gatya item data: root data must be an array");
  }
  return {
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    data: value.data.map(parseItemEntry),
  };
}

export function parseIdNameCsv(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) continue;
    const id = Number(line.slice(0, commaIndex).trim());
    const name = line.slice(commaIndex + 1).trim();
    if (Number.isInteger(id) && name) names.set(id, name);
  }
  return names;
}

export function parseSeriesMappingTsv(text: string): Map<number, number> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return new Map();
  const headers = lines[0].split("\t").map((value) => value.trim());
  const gachaIdIndex = headers.indexOf("GatyaSetID");
  const seriesIdIndex = headers.indexOf("seriesID");
  if (gachaIdIndex === -1 || seriesIdIndex === -1) {
    throw new Error("Invalid gatya series mapping: required columns are missing");
  }
  const mappings = new Map<number, number>();
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const gachaId = Number(cells[gachaIdIndex]?.trim());
    const seriesId = Number(cells[seriesIdIndex]?.trim());
    if (Number.isInteger(gachaId) && Number.isInteger(seriesId)) {
      mappings.set(gachaId, seriesId);
    }
  }
  return mappings;
}
