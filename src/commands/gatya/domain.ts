import {
  GachaMode,
  GachaModeMaps,
  GachaTarget,
  GatyaRequest,
} from "./types";

export function modeForGachaType(gachaType: number): GachaMode {
  if (gachaType === 1) return "R";
  if (gachaType === 4) return "E";
  return "N";
}

export function modeMatchesType(mode: GachaMode | null, gachaType: number): boolean {
  if (!mode) return true;
  if (mode === "R") return gachaType === 1;
  if (mode === "E") return gachaType === 4;
  return gachaType === 0;
}

export function getModeMap<T>(maps: GachaModeMaps<T>, gachaType: number): T {
  return maps[modeForGachaType(gachaType)];
}

function parseTarget(value: string): GachaTarget | undefined {
  if (/^-?\d+$/.test(value)) return { kind: "gacha", id: Number(value) };
  const seriesMatch = /^s(\d+)$/i.exec(value);
  return seriesMatch ? { kind: "series", id: Number(seriesMatch[1]) } : undefined;
}

export function parseGatyaRequest(args: readonly string[]): GatyaRequest {
  let mode: GachaMode | null = null;
  let rest = [...args];
  const first = rest[0]?.toUpperCase();
  if (first === "R" || first === "E" || first === "N") {
    mode = first;
    rest = rest.slice(1);
  }
  if (rest.length === 0) return { kind: "schedule", mode };

  if (rest.length === 2) {
    const target = parseTarget(rest[0]);
    const modifier = rest[1].toLowerCase();
    if (target && (modifier === "j" || modifier === "json")) {
      return { kind: "json", mode, target };
    }
    if (target && (modifier === "r" || modifier === "raw")) {
      return { kind: "raw", mode, target };
    }
  }

  if (rest.length === 1) {
    const target = parseTarget(rest[0]);
    if (target) return { kind: "detail", mode, target };
  }
  return { kind: "search", mode, query: rest.join(" ").trim() };
}

export function getSeriesId(
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
  gachaType: number,
  gachaId: number,
): number | undefined {
  return getModeMap(mappings, gachaType).get(gachaId);
}

export function getSeriesMemberIds(
  mapping: ReadonlyMap<number, number>,
  seriesId: number,
): readonly number[] {
  return [...mapping]
    .filter(([, mappedSeriesId]) => mappedSeriesId === seriesId)
    .map(([gachaId]) => gachaId)
    .sort((left, right) => left - right);
}

export function mergeSeriesNames(
  fullNames: GachaModeMaps<ReadonlyMap<number, string>>,
  shortNames: GachaModeMaps<ReadonlyMap<number, string>>,
): GachaModeMaps<ReadonlyMap<number, string>> {
  const merge = (mode: GachaMode) => {
    const merged = new Map(shortNames[mode]);
    for (const [id, name] of fullNames[mode]) merged.set(id, name);
    return merged;
  };
  return { R: merge("R"), E: merge("E"), N: merge("N") };
}

export function deriveSeriesNames(
  gachaNames: GachaModeMaps<ReadonlyMap<number, string>>,
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
): GachaModeMaps<ReadonlyMap<number, string>> {
  const derive = (mode: GachaMode) => {
    const names = new Map<number, string>();
    const sortedMappings = [...mappings[mode]].sort(([left], [right]) => left - right);
    for (const [gachaId, seriesId] of sortedMappings) {
      if (names.has(seriesId)) continue;
      const name = gachaNames[mode].get(gachaId);
      if (name) names.set(seriesId, name);
    }
    return names;
  };
  return { R: derive("R"), E: derive("E"), N: derive("N") };
}

export function overlaySeriesNames(
  fallbackNames: GachaModeMaps<ReadonlyMap<number, string>>,
  preferredNames: GachaModeMaps<ReadonlyMap<number, string>>,
): GachaModeMaps<ReadonlyMap<number, string>> {
  const overlay = (mode: GachaMode) => {
    const names = new Map(fallbackNames[mode]);
    for (const [id, name] of preferredNames[mode]) names.set(id, name);
    return names;
  };
  return { R: overlay("R"), E: overlay("E"), N: overlay("N") };
}
