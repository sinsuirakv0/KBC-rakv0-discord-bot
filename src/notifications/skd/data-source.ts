import { createHash } from "node:crypto";
import { parseGatya } from "./parsers/gatya";
import { parseSale } from "./parsers/sale";
import { parseItem } from "./parsers/item";
import { parseGachaJson } from "../../commands/gatya/parsers";
import { parseSaleJson } from "../../commands/sale/parsers";
import { parseItemJson } from "../../commands/item/parsers";
import { remoteGatyaDataSource } from "../../commands/gatya/data-source";
import { remoteSaleDataSource } from "../../commands/sale/data-source";
import { remoteItemDataSource } from "../../commands/item/data-source";
import { skdHistoryUrl, skdHttpTimeoutMs, skdMaxDocumentBytes, skdSourceBaseUrl } from "../../config/skd";
import { DetectionEvent } from "../types";
import { addedGachas, addedItems, addedSales } from "./diff";
import { AddedScheduleData, formatAddedSchedules } from "./formatters";

export function createScheduleDetailsBuilder(options = {
  fetch: globalThis.fetch, gatya: remoteGatyaDataSource, sale: remoteSaleDataSource, item: remoteItemDataSource,
}) {
  async function readText(ref: string, path: string) {
    const response = await options.fetch(`${skdSourceBaseUrl}/${ref}/${path}`, { signal: AbortSignal.timeout(skdHttpTimeoutMs) });
    if (!response.ok) throw new Error(`Schedule data unavailable: HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim() || Buffer.byteLength(text) > skdMaxDocumentBytes) throw new Error("Invalid schedule document size");
    return text;
  }
  return async (event: DetectionEvent): Promise<string[]> => {
    const source = event.source;
    if (!source) throw new Error("Missing schedule source");
    const data: AddedScheduleData = {};
    await Promise.all(event.types.map(async type => {
      const file = source.files[type]!;
      const [beforeText, afterText] = await Promise.all([readText(source.beforeRef, `data/${type}.json`), readText(source.afterRef, file.path)]);
      if (createHash("md5").update(afterText).digest("hex") !== file.hash) throw new Error("Schedule hash mismatch");
      const before: unknown = JSON.parse(beforeText.replace(/^\uFEFF/, ""));
      if (type === "gatya") {
        const after = parseGachaJson({ data: parseGatya(afterText) });
        if (!after.data.length && /\d/.test(afterText)) throw new Error("Unparsed gatya data");
        data.gatya = await options.gatya.fetchScheduleData(addedGachas(parseGachaJson(before), after), { updatedAt: "", data: [] });
      } else if (type === "sale") {
        const after = parseSaleJson({ data: parseSale(afterText) });
        data.sale = await options.sale.fetchDisplayData(addedSales(parseSaleJson(before), after));
      } else {
        const after = parseItemJson({ data: parseItem(afterText) });
        data.item = await options.item.fetchDisplayData(addedItems(parseItemJson(before), after));
      }
    }));
    return formatAddedSchedules(data, new Date(event.detectedAt), skdHistoryUrl(Object.values(source.files).map(file => file!.path)));
  };
}
