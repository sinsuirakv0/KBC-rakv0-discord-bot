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
import { skdHistoryUrl, skdHttpTimeoutMs, skdMaxDocumentBytes, skdSourceBaseUrl, skdSourceTreeUrl } from "../../config/skd";
import { DetectionEvent } from "../types";
import { compareGachas, compareItems, compareSales, ScheduleChanges } from "./diff";
import { AddedScheduleData, formatAddedSchedules } from "./formatters";

export function createScheduleDetailsBuilder(options = {
  fetch: globalThis.fetch, gatya: remoteGatyaDataSource, sale: remoteSaleDataSource, item: remoteItemDataSource,
}) {
  async function readText(url: string) {
    const response = await options.fetch(url, { signal: AbortSignal.timeout(skdHttpTimeoutMs) });
    if (!response.ok) throw new Error(`Schedule data unavailable: HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim() || Buffer.byteLength(text) > skdMaxDocumentBytes) throw new Error("Invalid schedule document size");
    return text;
  }
  return async (event: DetectionEvent): Promise<string[]> => {
    const source = event.source;
    if (!source) throw new Error("Missing schedule source");
    const tree = JSON.parse(await readText(`${skdSourceTreeUrl}/${source.beforeRef}?recursive=1`)) as {
      truncated?: boolean; tree?: { path: string; type: string }[];
    } | null;
    if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)
      || tree.tree.some(entry => !entry || typeof entry.path !== "string" || typeof entry.type !== "string")) {
      throw new Error("Invalid schedule history tree");
    }
    const rawPaths = tree.tree.filter(entry => entry.type === "blob").map(entry => entry.path);
    const changes: ScheduleChanges = {};
    const data: AddedScheduleData = { changes };
    await Promise.all(event.types.map(async type => {
      const file = source.files[type]!;
      const previousPath = rawPaths.filter(path => new RegExp(`^raw/${type}_[0-9]+\\.tsv$`).test(path))
        .sort((a, b) => Number(/_(\d+)\.tsv$/.exec(b)![1]) - Number(/_(\d+)\.tsv$/.exec(a)![1]))[0];
      if (!previousPath) throw new Error(`Previous ${type} TSV unavailable`);
      const [beforeText, afterText] = await Promise.all([
        readText(`${skdSourceBaseUrl}/${source.beforeRef}/${previousPath}`),
        readText(`${skdSourceBaseUrl}/${source.afterRef}/${file.path}`),
      ]);
      if (createHash("md5").update(afterText).digest("hex") !== file.hash) throw new Error("Schedule hash mismatch");
      if (type === "gatya") {
        const before = parseGachaJson({ data: parseGatya(beforeText) });
        const after = parseGachaJson({ data: parseGatya(afterText) });
        if (!after.data.length && /\d/.test(afterText)) throw new Error("Unparsed gatya data");
        const result = compareGachas(before, after);
        changes.gatya = result.changes;
        data.gatya = await options.gatya.fetchScheduleData(result.added, { updatedAt: "", data: [] });
      } else if (type === "sale") {
        const before = parseSaleJson({ data: parseSale(beforeText) });
        const after = parseSaleJson({ data: parseSale(afterText) });
        const result = compareSales(before, after);
        changes.sale = result.changes;
        data.sale = await options.sale.fetchDisplayData(result.added);
      } else {
        const before = parseItemJson({ data: parseItem(beforeText) });
        const after = parseItemJson({ data: parseItem(afterText) });
        const result = compareItems(before, after);
        changes.item = result.changes;
        data.item = await options.item.fetchDisplayData(result.added);
      }
    }));
    return formatAddedSchedules(data, new Date(event.detectedAt), skdHistoryUrl(Object.values(source.files).map(file => file!.path)));
  };
}
