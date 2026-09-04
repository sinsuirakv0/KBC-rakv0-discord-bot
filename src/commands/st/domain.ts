import {
  IndividualStageEntry,
  StageMapEntry,
  StageNameRows,
  StageSearchData,
  StageSearchEntry,
  StageSearchRawData,
  StageTypeRange,
} from "./types";
import { normalizeSearchText } from "../shared/search";

export interface ChapterStageDefinition {
  fileName: string;
  rawMapStart: number;
  jdbType: string;
}

export const chapterStageDefinitions: readonly ChapterStageDefinition[] = [
  { fileName: "StageName0_ja.csv", rawMapStart: 3_000, jdbType: "0" },
  { fileName: "StageName1_ja.csv", rawMapStart: 3_003, jdbType: "1" },
  { fileName: "StageName2_ja.csv", rawMapStart: 3_006, jdbType: "2" },
  { fileName: "StageName0Z_ja.csv", rawMapStart: 20_000, jdbType: "0Z" },
  { fileName: "StageName1Z_ja.csv", rawMapStart: 21_000, jdbType: "1Z" },
  { fileName: "StageName2Z_ja.csv", rawMapStart: 22_000, jdbType: "2Z" },
];

const filibusterMaps = new Map<number, { type: string; map: number }>([
  [23_000, { type: "2_Inv", map: 0 }],
  [38_000, { type: "2Z_Inv", map: 0 }],
]);

export const normalizeStageSearchText = normalizeSearchText;

function padId(value: number): string {
  return String(value).padStart(3, "0");
}

function allRanges(stageTypes: readonly StageTypeRange[]): readonly StageTypeRange[] {
  const ranges = [{ from: 0, to: 999, type: "N" }, ...stageTypes];
  const seenTypes = new Set<string>();
  for (const range of ranges) {
    const normalizedType = range.type.toLowerCase();
    if (seenTypes.has(normalizedType)) {
      throw new Error(`Duplicate stage type: ${range.type}`);
    }
    seenTypes.add(normalizedType);
  }
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].from <= sorted[index - 1].to) {
      throw new Error("Stage type ranges overlap");
    }
  }
  const reservedMapIds = [
    ...chapterStageDefinitions.flatMap((definition) => [
      definition.rawMapStart,
      definition.rawMapStart + 1,
      definition.rawMapStart + 2,
    ]),
    ...filibusterMaps.keys(),
  ];
  if (ranges.some((range) =>
    reservedMapIds.some((id) => id >= range.from && id <= range.to))) {
    throw new Error("Stage type ranges overlap a reserved map ID");
  }
  return ranges;
}

function addIndexEntry(
  index: Map<string, StageSearchEntry>,
  key: string,
  entry: StageSearchEntry,
): void {
  const existing = index.get(key);
  if (existing && existing !== entry) throw new Error(`Duplicate stage search ID: ${key}`);
  index.set(key, entry);
}

function rawIdKey(rawMapId: number, stageIndex?: number): string {
  return stageIndex === undefined
    ? `raw:${rawMapId}`
    : `raw:${rawMapId}:stage:${stageIndex}`;
}

function typeIdKey(type: string, map: number, stageIndex?: number): string {
  const base = `type:${type.toLowerCase()}:${map}`;
  return stageIndex === undefined ? base : `${base}:stage:${stageIndex}`;
}

function findRoute(
  rawMapId: number,
  ranges: readonly StageTypeRange[],
): { type: string; map: number; displayId: string; displayType?: string } | undefined {
  for (const range of ranges) {
    if (rawMapId >= range.from && rawMapId <= range.to) {
      const map = rawMapId - range.from;
      return {
        type: range.type,
        map,
        displayId: `${range.type}${padId(map)}`,
        displayType: range.type,
      };
    }
  }
  for (const definition of chapterStageDefinitions) {
    if (rawMapId >= definition.rawMapStart && rawMapId <= definition.rawMapStart + 2) {
      return {
        type: definition.jdbType,
        map: rawMapId - definition.rawMapStart,
        displayId: String(rawMapId),
      };
    }
  }
  const filibuster = filibusterMaps.get(rawMapId);
  if (filibuster) {
    return {
      type: filibuster.type,
      map: filibuster.map,
      displayId: `${filibuster.type}${padId(filibuster.map)}`,
      displayType: filibuster.type,
    };
  }
  return undefined;
}

function buildMapEntries(
  rawData: StageSearchRawData,
  ranges: readonly StageTypeRange[],
): StageMapEntry[] {
  const maps: StageMapEntry[] = [];
  for (const [rawMapId, mapName] of rawData.mapNames) {
    const route = findRoute(rawMapId, ranges);
    if (!route) throw new Error(`Map_Name.csv ID ${rawMapId} has no JDB route`);
    const alias = rawMapId >= 1_000 ? rawData.saleNames.get(rawMapId) : undefined;
    const oldName = mapName.includes("(旧)") || mapName.includes("（旧）");
    const searchNames = alias && alias !== mapName ? [mapName, alias] : [mapName];
    maps.push({
      kind: "map",
      rawMapId,
      displayId: route.displayId,
      displayName: oldName ? mapName : alias ?? mapName,
      searchNames,
      jdbType: route.type,
      jdbMap: route.map,
      ...(route.displayType
        ? { displayType: route.displayType, displayMap: route.map }
        : {}),
    });
  }
  return maps.sort((left, right) => left.rawMapId - right.rawMapId);
}

function appendStages(
  target: IndividualStageEntry[],
  rows: StageNameRows,
  rawMapStart: number,
  jdbType: string,
  displayType?: string,
): void {
  for (let map = 0; map < rows.length; map += 1) {
    for (let stageIndex = 0; stageIndex < rows[map].length; stageIndex += 1) {
      const displayName = rows[map][stageIndex];
      if (!displayName) continue;
      const rawMapId = rawMapStart + map;
      const mapDisplayId = displayType ? `${displayType}${padId(map)}` : String(rawMapId);
      target.push({
        kind: "stage",
        rawMapId,
        stageIndex,
        displayId: `${mapDisplayId}-${padId(stageIndex)}`,
        displayName,
        jdbType,
        jdbMap: map,
        ...(displayType ? { displayType, displayMap: map } : {}),
      });
    }
  }
}

function buildStageEntries(
  rawData: StageSearchRawData,
  ranges: readonly StageTypeRange[],
): IndividualStageEntry[] {
  const stages: IndividualStageEntry[] = [];
  for (const range of ranges) {
    const rows = rawData.normalStages.get(range.type);
    if (!rows) throw new Error(`Missing parsed stage names for type ${range.type}`);
    if (rows.length - 1 > range.to - range.from) {
      throw new Error(`Stage names for type ${range.type} exceed its configured range`);
    }
    appendStages(stages, rows, range.from, range.type, range.type);
  }
  for (const definition of chapterStageDefinitions) {
    const rows = rawData.chapterStages.get(definition.fileName);
    if (!rows || rows.length !== 3) {
      throw new Error(`${definition.fileName} must contain exactly 3 chapter rows`);
    }
    appendStages(stages, rows, definition.rawMapStart, definition.jdbType);
  }
  return stages.sort(
    (left, right) =>
      left.rawMapId - right.rawMapId || left.stageIndex - right.stageIndex,
  );
}

export function buildStageSearchData(rawData: StageSearchRawData): StageSearchData {
  const ranges = allRanges(rawData.stageTypes);
  const maps = buildMapEntries(rawData, ranges);
  const stages = buildStageEntries(rawData, ranges);
  const idIndex = new Map<string, StageSearchEntry>();
  for (const entry of [...maps, ...stages]) {
    const stageIndex = entry.kind === "stage" ? entry.stageIndex : undefined;
    addIndexEntry(idIndex, rawIdKey(entry.rawMapId, stageIndex), entry);
    if (entry.displayType !== undefined && entry.displayMap !== undefined) {
      addIndexEntry(
        idIndex,
        typeIdKey(entry.displayType, entry.displayMap, stageIndex),
        entry,
      );
    }
  }
  const displayTypes = [...new Set(
    [...maps, ...stages].flatMap((entry) =>
      entry.displayType ? [entry.displayType] : []),
  )].sort((left, right) => right.length - left.length);
  return { maps, stages, displayTypes, idIndex };
}

function parseIdKey(query: string, displayTypes: readonly string[]): string | undefined {
  if (!/^[A-Za-z0-9_]+(?:-\d+)?$/.test(query)) return undefined;
  const [base, stagePart] = query.split("-");
  const stageIndex = stagePart === undefined ? undefined : Number(stagePart);
  if (stageIndex !== undefined && !Number.isSafeInteger(stageIndex)) return undefined;
  if (/^\d+$/.test(base)) {
    const rawMapId = Number(base);
    return Number.isSafeInteger(rawMapId) ? rawIdKey(rawMapId, stageIndex) : undefined;
  }
  const lowerBase = base.toLowerCase();
  for (const displayType of displayTypes) {
    const normalizedType = displayType.toLowerCase();
    if (!lowerBase.startsWith(normalizedType)) continue;
    const mapPart = base.slice(displayType.length);
    if (!/^\d+$/.test(mapPart)) continue;
    const map = Number(mapPart);
    if (Number.isSafeInteger(map)) return typeIdKey(displayType, map, stageIndex);
  }
  return undefined;
}

function nameMatches(name: string, words: readonly string[], force: boolean): boolean {
  const searchableName = force ? name : normalizeStageSearchText(name);
  return words.every((word) => searchableName.includes(word));
}

export function searchStages(
  data: StageSearchData,
  query: string,
  force: boolean,
): readonly StageSearchEntry[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  if (!force) {
    const idKey = parseIdKey(trimmedQuery, data.displayTypes);
    const idMatch = idKey ? data.idIndex.get(idKey) : undefined;
    if (idMatch) return [idMatch];
  }
  const words = (force ? trimmedQuery : normalizeStageSearchText(trimmedQuery))
    .split(/\s+/)
    .filter(Boolean);
  const mapMatches = data.maps.filter((entry) =>
    entry.searchNames.some((name) => nameMatches(name, words, force)),
  );
  const stageMatches = data.stages.filter((entry) =>
    nameMatches(entry.displayName, words, force),
  );
  return [...mapMatches, ...stageMatches];
}
