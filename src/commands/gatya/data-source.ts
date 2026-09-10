import { gatyaDataUrls, gatyaHttpTimeoutMs, GatyaDataUrls } from "../../config/gatya";
import { deriveSeriesNames, overlaySeriesNames } from "./domain";
import {
  parseGachaJson,
  parseIdNameCsv,
  parseItemScheduleJson,
  parseSeriesMappingTsv,
} from "./parsers";
import { GachaMode, GachaModeMaps, GatyaDataSource } from "./types";

export interface RemoteGatyaDataSourceOptions {
  urls?: GatyaDataUrls;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

async function fetchText(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Gatya data request failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptionalText(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Gatya optional data request failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseGachaText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid gatya data: response is not JSON");
  }
  return parseGachaJson(value);
}

function parseItemText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid gatya item data: response is not JSON");
  }
  return parseItemScheduleJson(value);
}

async function fetchModeMaps<T>(
  urls: Readonly<Record<GachaMode, string>>,
  load: (url: string) => Promise<string>,
  parse: (text: string) => T,
): Promise<GachaModeMaps<T>> {
  const [r, e, n] = await Promise.all([
    load(urls.R),
    load(urls.E),
    load(urls.N),
  ]);
  return { R: parse(r), E: parse(e), N: parse(n) };
}

async function fetchOptionalNameMaps(
  urls: Readonly<Partial<Record<GachaMode, string>>> | undefined,
  load: (url: string) => Promise<string | undefined>,
): Promise<GachaModeMaps<ReadonlyMap<number, string>>> {
  const loadMode = async (mode: GachaMode): Promise<ReadonlyMap<number, string>> => {
    const url = urls?.[mode];
    if (!url) return new Map();
    const text = await load(url);
    return text === undefined ? new Map() : parseIdNameCsv(text);
  };
  const [r, e, n] = await Promise.all([loadMode("R"), loadMode("E"), loadMode("N")]);
  return { R: r, E: e, N: n };
}

export function createRemoteGatyaDataSource(
  options: RemoteGatyaDataSourceOptions = {},
): GatyaDataSource {
  const urls = options.urls ?? gatyaDataUrls;
  const timeoutMs = options.timeoutMs ?? gatyaHttpTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const load = (url: string) => fetchText(url, timeoutMs, fetchImpl);
  const loadOptional = (url: string) => fetchOptionalText(url, timeoutMs, fetchImpl);
  const fetchJson = async () => parseGachaText(await load(urls.gachaJson));
  const fetchItemJson = async () => parseItemText(await load(urls.itemJson));
  const fetchMappings = () =>
    fetchModeMaps(urls.seriesMappings, load, parseSeriesMappingTsv);
  const fetchGachaNames = () => fetchModeMaps(urls.gachaNames, load, parseIdNameCsv);
  const fetchShortNames = () => fetchOptionalNameMaps(urls.shortSeriesNames, loadOptional);
  const fetchFullSeriesNames = () => fetchOptionalNameMaps(urls.seriesNames, loadOptional);

  return {
    fetchGachaJson: fetchJson,
    async fetchJsonWithMappings() {
      const [gacha, seriesMappings] = await Promise.all([fetchJson(), fetchMappings()]);
      return { gacha, seriesMappings };
    },
    async fetchScheduleData(providedGacha, providedItem) {
      const [
        gacha,
        item,
        saleNamesText,
        gachaNames,
        optionalShortNames,
        seriesMappings,
      ] = await Promise.all([
        providedGacha ?? fetchJson(),
        providedItem ?? fetchItemJson(),
        load(urls.saleNames),
        fetchGachaNames(),
        fetchShortNames(),
        fetchMappings(),
      ]);
      const shortSeriesNames = overlaySeriesNames(
        deriveSeriesNames(gachaNames, seriesMappings),
        optionalShortNames,
      );
      return {
        gacha,
        item,
        saleNames: parseIdNameCsv(saleNamesText),
        shortSeriesNames,
        seriesMappings,
      };
    },
    async fetchLookupData() {
      const [gacha, gachaNames, seriesNames, optionalShortNames, seriesMappings] =
        await Promise.all([
          fetchJson(),
          fetchGachaNames(),
          fetchFullSeriesNames(),
          fetchShortNames(),
          fetchMappings(),
        ]);
      const shortSeriesNames = overlaySeriesNames(
        deriveSeriesNames(gachaNames, seriesMappings),
        optionalShortNames,
      );
      return { gacha, gachaNames, seriesNames, shortSeriesNames, seriesMappings };
    },
  };
}

export const remoteGatyaDataSource = createRemoteGatyaDataSource();
