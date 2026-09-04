import { StageNameRows, StageTypeRange, StRequest } from "./types";

function linesWithoutTrailingEmpty(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function parseInteger(value: string, label: string): number {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new Error(`Invalid ${label}: integer is required`);
  }
  const result = Number(value.trim());
  if (!Number.isSafeInteger(result)) {
    throw new Error(`Invalid ${label}: integer is out of range`);
  }
  return result;
}

export function parseStRequest(args: readonly string[]): StRequest {
  if (args.length === 0) return { kind: "landing" };
  const flag = args[0].toLowerCase();
  const force = flag === "-f" || flag === "-force";
  const query = (force ? args.slice(1) : args).join(" ").trim();
  if (force && !query) return { kind: "help" };
  return { kind: "search", query, force };
}

export function parseStageTypeCsv(text: string): readonly StageTypeRange[] {
  const lines = linesWithoutTrailingEmpty(text);
  if (lines.length < 2) throw new Error("Invalid stage_type.csv: data rows are required");
  const header = lines[0].split(",").map((value) => value.trim().toLowerCase());
  if (header.length !== 3 || header.join(",") !== "from,to,type") {
    throw new Error("Invalid stage_type.csv: header must be from,to,type");
  }

  const seenTypes = new Set<string>();
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((value) => value.trim());
    if (cells.length !== 3) {
      throw new Error(`Invalid stage_type.csv: row ${index + 2} must have 3 columns`);
    }
    const from = parseInteger(cells[0], "stage_type.csv from");
    const to = parseInteger(cells[1], "stage_type.csv to");
    const type = cells[2];
    const normalizedType = type.toLowerCase();
    if (
      from < 0 ||
      to < from ||
      to - from > 999 ||
      !/^[a-z][a-z0-9_]*$/i.test(type) ||
      seenTypes.has(normalizedType)
    ) {
      throw new Error(`Invalid stage_type.csv: row ${index + 2} has an invalid range or type`);
    }
    seenTypes.add(normalizedType);
    return { from, to, type };
  });
}

export function parseIdNameCsv(
  text: string,
  label: string,
  allowNegativeIds: boolean,
): ReadonlyMap<number, string> {
  const names = new Map<number, string>();
  const lines = linesWithoutTrailingEmpty(text);
  if (lines.length === 0) throw new Error(`Invalid ${label}: data rows are required`);
  for (let index = 0; index < lines.length; index += 1) {
    const commaIndex = lines[index].indexOf(",");
    if (commaIndex === -1) {
      throw new Error(`Invalid ${label}: row ${index + 1} must contain an ID and name`);
    }
    const id = parseInteger(lines[index].slice(0, commaIndex), `${label} ID`);
    if ((!allowNegativeIds && id < 0) || names.has(id)) {
      throw new Error(`Invalid ${label}: row ${index + 1} has an invalid or duplicate ID`);
    }
    const name = lines[index].slice(commaIndex + 1).trim();
    if (name && name !== "@" && name !== "＠") names.set(id, name);
  }
  if (names.size === 0) throw new Error(`Invalid ${label}: searchable names are required`);
  return names;
}

export function parseStageNameCsv(text: string, label: string): StageNameRows {
  const lines = linesWithoutTrailingEmpty(text);
  if (lines.length === 0) throw new Error(`Invalid ${label}: data rows are required`);
  const rows = lines.map((line, rowIndex) => {
    const cells = line.split(",");
    if (cells.length > 1_000) {
      throw new Error(`Invalid ${label}: row ${rowIndex + 1} has too many stages`);
    }
    return cells.map((cell) => {
      const name = cell.trim();
      return name && name !== "@" && name !== "＠" ? name : undefined;
    });
  });
  if (!rows.some((row) => row.some(Boolean))) {
    throw new Error(`Invalid ${label}: searchable stage names are required`);
  }
  return rows;
}
