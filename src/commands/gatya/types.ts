export type GachaMode = "R" | "E" | "N";

export interface GachaRate {
  normal: number;
  rare: number;
  superRare: number;
  uberRare: number;
  legendRare: number;
}

export interface GachaEntry {
  id: number;
  price: number;
  flags: number;
  rates: GachaRate;
  guaranteed: boolean;
  message?: string;
}

export interface GachaHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
  gachaType: number;
  gachaCount: number;
}

export interface GachaBlock {
  header: GachaHeader;
  gachas: readonly GachaEntry[];
  raw?: string;
}

export interface GachaJson {
  updatedAt: string;
  data: readonly GachaBlock[];
}

export interface ItemScheduleHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface ItemScheduleEntry {
  header: ItemScheduleHeader;
  gift: {
    giftType: number;
  };
}

export interface ItemScheduleJson {
  updatedAt: string;
  data: readonly ItemScheduleEntry[];
}

export type GachaModeMaps<T> = Readonly<Record<GachaMode, T>>;

export interface GachaScheduleData {
  gacha: GachaJson;
  item: ItemScheduleJson;
  saleNames: ReadonlyMap<number, string>;
  shortSeriesNames: GachaModeMaps<ReadonlyMap<number, string>>;
  seriesMappings: GachaModeMaps<ReadonlyMap<number, number>>;
}

export interface GachaLookupData {
  gacha: GachaJson;
  gachaNames: GachaModeMaps<ReadonlyMap<number, string>>;
  seriesNames: GachaModeMaps<ReadonlyMap<number, string>>;
  shortSeriesNames: GachaModeMaps<ReadonlyMap<number, string>>;
  seriesMappings: GachaModeMaps<ReadonlyMap<number, number>>;
}

export interface GachaJsonWithMappings {
  gacha: GachaJson;
  seriesMappings: GachaModeMaps<ReadonlyMap<number, number>>;
}

export interface GatyaDataSource {
  fetchGachaJson(): Promise<GachaJson>;
  fetchJsonWithMappings(): Promise<GachaJsonWithMappings>;
  fetchScheduleData(gacha?: GachaJson, item?: ItemScheduleJson): Promise<GachaScheduleData>;
  fetchLookupData(): Promise<GachaLookupData>;
}

export type GachaTarget =
  | { kind: "gacha"; id: number }
  | { kind: "series"; id: number };

export type GatyaRequest =
  | { kind: "schedule"; mode: GachaMode | null }
  | { kind: "detail"; mode: GachaMode | null; target: GachaTarget }
  | { kind: "json"; mode: GachaMode | null; target: GachaTarget }
  | { kind: "raw"; mode: GachaMode | null; target: GachaTarget }
  | { kind: "search"; mode: GachaMode | null; query: string };
