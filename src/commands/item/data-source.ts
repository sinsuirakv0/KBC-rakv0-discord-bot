import { itemDataUrls, itemHttpTimeoutMs, ItemDataUrls } from "../../config/item";
import { parseIdNameCsv, parseItemJson, parseItemNameCsv } from "./parsers";
import { ItemDataSource, ItemJson } from "./types";

export interface RemoteItemDataSourceOptions {
  urls?: ItemDataUrls;
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
      throw new Error(`Item data request failed with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseItemText(text: string): ItemJson {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Invalid item data: response is not JSON");
  }
  return parseItemJson(value);
}

export function createRemoteItemDataSource(
  options: RemoteItemDataSourceOptions = {},
): ItemDataSource {
  const urls = options.urls ?? itemDataUrls;
  const timeoutMs = options.timeoutMs ?? itemHttpTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const load = (url: string) => fetchText(url, timeoutMs, fetchImpl);

  return {
    async fetchItemJson() {
      return parseItemText(await load(urls.itemJson));
    },
    async fetchDisplayData() {
      const [itemText, itemNamesText, saleNamesText] = await Promise.all([
        load(urls.itemJson),
        load(urls.itemNames),
        load(urls.saleNames),
      ]);
      return {
        item: parseItemText(itemText),
        itemNames: parseItemNameCsv(itemNamesText),
        saleNames: parseIdNameCsv(saleNamesText),
      };
    },
  };
}

export const remoteItemDataSource = createRemoteItemDataSource();
