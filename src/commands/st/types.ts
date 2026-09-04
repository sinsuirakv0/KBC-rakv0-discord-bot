export interface StageTypeRange {
  from: number;
  to: number;
  type: string;
}

export type StageNameRows = readonly (readonly (string | undefined)[])[];

interface StageSearchEntryBase {
  rawMapId: number;
  displayId: string;
  displayName: string;
  jdbType: string;
  jdbMap: number;
}

export interface StageMapEntry extends StageSearchEntryBase {
  kind: "map";
  searchNames: readonly string[];
  displayType?: string;
  displayMap?: number;
}

export interface IndividualStageEntry extends StageSearchEntryBase {
  kind: "stage";
  stageIndex: number;
  displayType?: string;
  displayMap?: number;
}

export type StageSearchEntry = StageMapEntry | IndividualStageEntry;

export interface StageSearchData {
  maps: readonly StageMapEntry[];
  stages: readonly IndividualStageEntry[];
  displayTypes: readonly string[];
  idIndex: ReadonlyMap<string, StageSearchEntry>;
}

export interface StageSearchRawData {
  stageTypes: readonly StageTypeRange[];
  mapNames: ReadonlyMap<number, string>;
  saleNames: ReadonlyMap<number, string>;
  normalStages: ReadonlyMap<string, StageNameRows>;
  chapterStages: ReadonlyMap<string, StageNameRows>;
}

export interface StDataSource {
  fetchSearchData(): Promise<StageSearchData>;
}

export type StRequest =
  | { kind: "landing" }
  | { kind: "help" }
  | { kind: "search"; query: string; force: boolean };
