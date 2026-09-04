import { SaleEntry, SaleRequest } from "./types";

export interface StageNameSources {
  saleNames: ReadonlyMap<number, string>;
  allDayEventNames: ReadonlyMap<number, string>;
  missionNames: ReadonlyMap<number, string>;
}

export function parseSaleRequest(args: readonly string[]): SaleRequest {
  if (args.length === 0) return { kind: "schedule" };

  const first = args[0].trim();
  if (/^-?\d+$/.test(first)) {
    const id = Number(first);
    const modifier = args[1]?.toLowerCase();
    if (modifier === "j" || modifier === "json") return { kind: "json", id };
    if (modifier === "r" || modifier === "raw") return { kind: "raw", id };
    return { kind: "detail", id };
  }

  return { kind: "search", query: args.join(" ").trim() };
}

export function isMissionId(id: number): boolean {
  return (
    (id >= 8000 && id <= 9999) ||
    (id >= 15000 && id <= 15999) ||
    (id >= 17000 && id <= 17999)
  );
}

function stripDisplayMarkup(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function getStageName(id: number, sources: StageNameSources): string {
  if (isMissionId(id)) {
    const lookupId = id >= 15000 && id <= 15999 ? id - 15000 : id;
    const rawName = sources.missionNames.get(lookupId);
    if (!rawName) return "不明";
    const commaIndex = rawName.search(/[,，]/);
    return stripDisplayMarkup(
      commaIndex === -1 ? rawName : rawName.slice(0, commaIndex),
    );
  }
  const rawName = sources.saleNames.get(id) ?? sources.allDayEventNames.get(id);
  return rawName ? stripDisplayMarkup(rawName) : "不明";
}

export function mergeSaleNames(
  saleNames: ReadonlyMap<number, string>,
  allDayEventNames: ReadonlyMap<number, string>,
): ReadonlyMap<number, string> {
  const merged = new Map(saleNames);
  for (const [id, name] of allDayEventNames) {
    if (!merged.has(id)) merged.set(id, name);
  }
  return merged;
}

export function findNameMatches(
  query: string,
  saleNames: ReadonlyMap<number, string>,
  allDayEventNames: ReadonlyMap<number, string>,
): readonly (readonly [number, string])[] {
  const normalizedQuery = query.toLowerCase();
  return [...mergeSaleNames(saleNames, allDayEventNames)]
    .filter(
      ([id, name]) =>
        !isMissionId(id) && name.toLowerCase().includes(normalizedQuery),
    )
    .map(([id, name]) => [id, stripDisplayMarkup(name)] as const);
}

export function getRepresentativeStageId(
  entry: SaleEntry,
  cardSettingStageIds: readonly number[],
): number | undefined {
  if (entry.stageIds.length <= 1) return undefined;
  return cardSettingStageIds.find((id) => entry.stageIds.includes(id));
}

export function getListStageIds(
  entry: SaleEntry,
  cardSettingStageIds: readonly number[],
): readonly number[] {
  const representativeId = getRepresentativeStageId(entry, cardSettingStageIds);
  const displayIds = representativeId === undefined ? entry.stageIds : [representativeId];
  return displayIds.filter((id) => !isMissionId(id));
}
