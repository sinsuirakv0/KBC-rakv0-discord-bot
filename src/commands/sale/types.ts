export interface SaleHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface TimeBlock {
  dateRanges: readonly DateRange[];
  monthDays: readonly number[];
  weekdays: readonly string[];
  timeRanges: readonly (readonly [string, string])[];
}

export interface SaleEntry {
  header: SaleHeader;
  timeBlocks: readonly TimeBlock[];
  stageIds: readonly number[];
  raw?: string;
}

export interface SaleJson {
  updatedAt: string;
  data: readonly SaleEntry[];
}

export interface SaleDisplayData {
  sale: SaleJson;
  saleNames: ReadonlyMap<number, string>;
  allDayEventNames: ReadonlyMap<number, string>;
  missionNames: ReadonlyMap<number, string>;
  cardSettingStageIds: readonly number[];
}

export interface SaleDataSource {
  fetchSaleJson(): Promise<SaleJson>;
  fetchDisplayData(sale?: SaleJson): Promise<SaleDisplayData>;
}

export type SaleRequest =
  | { kind: "schedule" }
  | { kind: "detail"; id: number }
  | { kind: "json"; id: number }
  | { kind: "raw"; id: number }
  | { kind: "search"; query: string };
