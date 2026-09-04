import { createHash } from "node:crypto";
import {
  StDataUrls,
  stCacheTtlMs,
  stDataUrls,
  stHttpTimeoutMs,
} from "../../config/st";
import { buildStageSearchData, chapterStageDefinitions } from "./domain";
import { parseIdNameCsv, parseStageNameCsv, parseStageTypeCsv } from "./parsers";
import { StageSearchData, StageTypeRange, StDataSource } from "./types";

interface ResourceState {
  text: string;
  hash: string;
  etag?: string;
  lastModified?: string;
}

interface SearchCacheEntry {
  value: StageSearchData;
  aggregateHash: string;
  validatedAt: number;
}

class HttpStatusError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`Stage data request failed with HTTP ${status}: ${url}`);
  }
}

export class MissingStageNameFilesError extends Error {
  constructor(readonly stageType: string) {
    super(`Both stage name file candidates returned HTTP 404 for type ${stageType}`);
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function joinUrl(base: string, fileName: string): string {
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`;
}

export interface RemoteStDataSourceOptions {
  urls?: StDataUrls;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createRemoteStDataSource(
  options: RemoteStDataSourceOptions = {},
): StDataSource {
  const urls = options.urls ?? stDataUrls;
  const timeoutMs = options.timeoutMs ?? stHttpTimeoutMs;
  const ttlMs = options.cacheTtlMs ?? stCacheTtlMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let resources = new Map<string, ResourceState>();
  let cache: SearchCacheEntry | undefined;
  let inFlight: Promise<StageSearchData> | undefined;

  const revalidate = async (): Promise<StageSearchData> => {
    const nextResources = new Map(resources);

    const fetchResource = async (url: string): Promise<string> => {
      const previous = resources.get(url);
      const headers = new Headers();
      if (previous?.etag) headers.set("If-None-Match", previous.etag);
      if (previous?.lastModified) {
        headers.set("If-Modified-Since", previous.lastModified);
      }
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs, { headers });
      if (response.status === 304) {
        if (!previous) throw new Error(`Unexpected HTTP 304 without cached data: ${url}`);
        nextResources.set(url, {
          ...previous,
          etag: response.headers.get("etag") ?? previous.etag,
          lastModified:
            response.headers.get("last-modified") ?? previous.lastModified,
        });
        return previous.text;
      }
      if (!response.ok) throw new HttpStatusError(url, response.status);
      const text = await response.text();
      const hash = sha256(text);
      nextResources.set(url, {
        text: previous?.hash === hash ? previous.text : text,
        hash,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      });
      return previous?.hash === hash ? previous.text : text;
    };

    const fetchNormalStageFile = async (
      range: StageTypeRange,
    ): Promise<{ type: string; text: string }> => {
      const prefixedName = `StageName_R${range.type}_ja.csv`;
      try {
        return {
          type: range.type,
          text: await fetchResource(joinUrl(urls.normalStageBase, prefixedName)),
        };
      } catch (error) {
        if (!(error instanceof HttpStatusError) || error.status !== 404) throw error;
      }
      const plainName = `StageName_${range.type}_ja.csv`;
      try {
        return {
          type: range.type,
          text: await fetchResource(joinUrl(urls.normalStageBase, plainName)),
        };
      } catch (error) {
        if (error instanceof HttpStatusError && error.status === 404) {
          throw new MissingStageNameFilesError(range.type);
        }
        throw error;
      }
    };

    try {
      const stageTypeText = await fetchResource(urls.stageTypes);
      const stageTypes = parseStageTypeCsv(stageTypeText);
      const ranges = [{ from: 0, to: 999, type: "N" }, ...stageTypes];
      const requests = [
        fetchResource(urls.mapNames),
        fetchResource(urls.saleNames),
        ...ranges.map(fetchNormalStageFile),
        ...chapterStageDefinitions.map(async (definition) => ({
          fileName: definition.fileName,
          text: await fetchResource(
            joinUrl(urls.chapterStageBase, definition.fileName),
          ),
        })),
      ];
      const results = await Promise.allSettled(requests);
      const missingFiles = results.find(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof MissingStageNameFilesError,
      );
      if (missingFiles?.status === "rejected") throw missingFiles.reason;
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const values = results.map(
        (result) => (result as PromiseFulfilledResult<unknown>).value,
      );
      const mapNameText = values[0] as string;
      const saleNameText = values[1] as string;
      const normalStart = 2;
      const chapterStart = normalStart + ranges.length;
      const normalFiles = values.slice(normalStart, chapterStart) as {
        type: string;
        text: string;
      }[];
      const chapterFiles = values.slice(chapterStart) as {
        fileName: string;
        text: string;
      }[];

      const aggregateParts: [string, string][] = [
        ["stage_type.csv", stageTypeText],
        ["Map_Name.csv", mapNameText],
        ["sale_name.csv", saleNameText],
        ...normalFiles
          .map((file): [string, string] => [`normal:${file.type}`, file.text])
          .sort(([left], [right]) => left.localeCompare(right)),
        ...chapterFiles
          .map((file): [string, string] => [`chapter:${file.fileName}`, file.text])
          .sort(([left], [right]) => left.localeCompare(right)),
      ];
      const aggregateHash = sha256(JSON.stringify(aggregateParts));
      let value = cache?.aggregateHash === aggregateHash ? cache.value : undefined;
      if (!value) {
        const normalStages = new Map(
          normalFiles.map((file) => [
            file.type,
            parseStageNameCsv(file.text, `stage names for type ${file.type}`),
          ]),
        );
        const chapterStages = new Map(
          chapterFiles.map((file) => [
            file.fileName,
            parseStageNameCsv(file.text, file.fileName),
          ]),
        );
        value = buildStageSearchData({
          stageTypes,
          mapNames: parseIdNameCsv(mapNameText, "Map_Name.csv", false),
          saleNames: parseIdNameCsv(saleNameText, "sale_name.csv", true),
          normalStages,
          chapterStages,
        });
      }
      resources = nextResources;
      cache = { value, aggregateHash, validatedAt: now() };
      return value;
    } catch (error) {
      if (error instanceof MissingStageNameFilesError || !cache) throw error;
      console.error("Stage data refresh failed; stale cache is used.", error);
      return cache.value;
    }
  };

  return {
    async fetchSearchData(): Promise<StageSearchData> {
      if (cache && now() - cache.validatedAt < ttlMs) return cache.value;
      if (!inFlight) {
        inFlight = revalidate().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}

export const remoteStDataSource = createRemoteStDataSource();
