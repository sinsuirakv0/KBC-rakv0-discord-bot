import { saleDataUrls, saleHttpTimeoutMs, SaleDataUrls } from "../../config/sale";
import {
  parseAllDayEventTsv,
  parseCardSetting,
  parseIdNameCsv,
  parseSaleJson,
} from "./parsers";
import { SaleDataSource, SaleJson } from "./types";

export interface RemoteSaleDataSourceOptions {
  urls?: SaleDataUrls;
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
      throw new Error(`Sale data request failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseSaleText(text: string): SaleJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid sale data: response is not JSON");
  }
  return parseSaleJson(value);
}

export function createRemoteSaleDataSource(
  options: RemoteSaleDataSourceOptions = {},
): SaleDataSource {
  const urls = options.urls ?? saleDataUrls;
  const timeoutMs = options.timeoutMs ?? saleHttpTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async fetchSaleJson() {
      return parseSaleText(await fetchText(urls.saleJson, timeoutMs, fetchImpl));
    },
    async fetchDisplayData() {
      const [saleText, saleNamesText, allDayText, missionNamesText, cardSettingText] =
        await Promise.all([
          fetchText(urls.saleJson, timeoutMs, fetchImpl),
          fetchText(urls.saleNames, timeoutMs, fetchImpl),
          fetchText(urls.allDayEventNames, timeoutMs, fetchImpl),
          fetchText(urls.missionNames, timeoutMs, fetchImpl),
          fetchText(urls.cardSetting, timeoutMs, fetchImpl),
        ]);
      return {
        sale: parseSaleText(saleText),
        saleNames: parseIdNameCsv(saleNamesText),
        allDayEventNames: parseAllDayEventTsv(allDayText),
        missionNames: parseIdNameCsv(missionNamesText),
        cardSettingStageIds: parseCardSetting(cardSettingText),
      };
    },
  };
}

export const remoteSaleDataSource = createRemoteSaleDataSource();
