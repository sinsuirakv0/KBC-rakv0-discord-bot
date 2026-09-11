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
import { skdHistoryUrl, skdHttpTimeoutMs, skdMaxDocumentBytes, skdSourceBaseUrl, skdSourceTreeUrl, skdSourceRevisionUrl } from "../../config/skd";
import { DetectionEvent, ScheduleType } from "../types";
import { compareGachas, compareItems, compareSales, ScheduleChanges } from "./diff";
import { AddedScheduleData, formatAddedSchedules } from "./formatters";

export interface ScheduleHistoryFile { type: ScheduleType; path: string; timestamp: number; }
export interface ScheduleFileReference { ref: string; path: string; hash?: string; }
export interface ScheduleComparison { type: ScheduleType; before?: ScheduleFileReference; after: ScheduleFileReference; }

const defaultOptions = {
  fetch: globalThis.fetch, gatya: remoteGatyaDataSource, sale: remoteSaleDataSource, item: remoteItemDataSource,
};

export function createScheduleDataSource(options = defaultOptions) {
  async function readText(url: string) {
    const response = await options.fetch(url, { signal: AbortSignal.timeout(skdHttpTimeoutMs) });
    if (!response.ok) throw new Error(`Schedule data unavailable: HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim() || Buffer.byteLength(text) > skdMaxDocumentBytes) throw new Error("Invalid schedule document size");
    return text;
  }
  async function readHistory(ref: string): Promise<ScheduleHistoryFile[]> {
    if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error("Invalid schedule revision");
    const tree = JSON.parse(await readText(`${skdSourceTreeUrl}/${ref}?recursive=1`)) as {
      truncated?: boolean; tree?: { path: string; type: string }[];
    } | null;
    if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)
      || tree.tree.some(entry => !entry || typeof entry.path !== "string" || typeof entry.type !== "string")) {
      throw new Error("Invalid schedule history tree");
    }
    return tree.tree.flatMap(entry => {
      const match = /^raw\/(gatya|sale|item)_(\d+)\.tsv$/.exec(entry.path);
      if (entry.type !== "blob" || !match) return [];
      const timestamp = Number(match[2]);
      if (!Number.isSafeInteger(timestamp) || !Number.isFinite(new Date(timestamp * 1000).getTime())) throw new Error("Invalid schedule timestamp");
      return [{ type: match[1] as ScheduleType, path: entry.path, timestamp }];
    });
  }
  async function readFile(file: ScheduleFileReference, type: ScheduleType): Promise<string> {
    if (!/^[a-f0-9]{40}$/.test(file.ref) || !new RegExp(`^raw/${type}_[0-9]+\\.tsv$`).test(file.path)) throw new Error("Invalid schedule file");
    const text = await readText(`${skdSourceBaseUrl}/${file.ref}/${file.path}`);
    if (file.hash && createHash("md5").update(text).digest("hex") !== file.hash) throw new Error("Schedule hash mismatch");
    return text;
  }
  async function buildDetails(comparisons: ScheduleComparison[], detectedAt: string): Promise<string[]> {
    const changes: ScheduleChanges = {};
    const data: AddedScheduleData = { changes };
    await Promise.all(comparisons.map(async comparison => {
      const { type } = comparison;
      const [beforeText, afterText] = await Promise.all([
        comparison.before ? readFile(comparison.before, type) : undefined,
        readFile(comparison.after, type),
      ]);
      if (type === "gatya") {
        const before = parseGachaJson({ data: beforeText === undefined ? [] : parseGatya(beforeText) });
        const after = parseGachaJson({ data: parseGatya(afterText) });
        if (!after.data.length && /\d/.test(afterText)) throw new Error("Unparsed gatya data");
        const result = compareGachas(before, after);
        changes.gatya = result.changes;
        data.gatya = await options.gatya.fetchScheduleData(result.added, { updatedAt: "", data: [] });
      } else if (type === "sale") {
        const before = parseSaleJson({ data: beforeText === undefined ? [] : parseSale(beforeText) });
        const after = parseSaleJson({ data: parseSale(afterText) });
        const result = compareSales(before, after);
        changes.sale = result.changes;
        data.sale = await options.sale.fetchDisplayData(result.added);
      } else {
        const before = parseItemJson({ data: beforeText === undefined ? [] : parseItem(beforeText) });
        const after = parseItemJson({ data: parseItem(afterText) });
        const result = compareItems(before, after);
        changes.item = result.changes;
        data.item = await options.item.fetchDisplayData(result.added);
      }
    }));
    return formatAddedSchedules(data, new Date(detectedAt), skdHistoryUrl(comparisons.map(comparison => comparison.after.path)));
  }
  return {
    readHistory,
    buildDetails,
    async readHistorySnapshot() {
      const value = JSON.parse(await readText(skdSourceRevisionUrl)) as { object?: { sha?: unknown } } | null;
      const ref = value?.object?.sha;
      if (typeof ref !== "string" || !/^[a-f0-9]{40}$/.test(ref)) throw new Error("Invalid schedule revision");
      return { ref, files: await readHistory(ref) };
    },
  };
}

export function createScheduleDetailsBuilder(options = defaultOptions) {
  const dataSource = createScheduleDataSource(options);
  return async (event: DetectionEvent): Promise<string[]> => {
    const source = event.source;
    if (!source) throw new Error("Missing schedule source");
    const history = await dataSource.readHistory(source.beforeRef);
    const comparisons = event.types.map(type => {
      const previous = history.filter(file => file.type === type).sort((a, b) => b.timestamp - a.timestamp)[0];
      if (!previous) throw new Error(`Previous ${type} TSV unavailable`);
      return { type, before: { ref: source.beforeRef, path: previous.path }, after: { ref: source.afterRef, ...source.files[type]! } };
    });
    return dataSource.buildDetails(comparisons, event.detectedAt);
  };
}
