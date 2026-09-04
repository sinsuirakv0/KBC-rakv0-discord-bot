import { createHash } from "node:crypto";
import {
  TutDataUrls,
  tutCacheTtlMs,
  tutDataUrls,
  tutHttpTimeoutMs,
} from "../../config/tut";
import { buildEnemyIconFilename, buildEnemySearchData } from "./domain";
import { parseEnemyAliasJson, parseEnemyNameTsv } from "./parsers";
import { EnemySearchData, TutDataSource } from "./types";

interface ResourceState {
  text: string;
  hash: string;
  etag?: string;
  lastModified?: string;
}

interface SearchCacheEntry {
  value: EnemySearchData;
  aggregateHash: string;
  validatedAt: number;
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

export interface RemoteTutDataSourceOptions {
  urls?: TutDataUrls;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createRemoteTutDataSource(
  options: RemoteTutDataSourceOptions = {},
): TutDataSource {
  const urls = options.urls ?? tutDataUrls;
  const timeoutMs = options.timeoutMs ?? tutHttpTimeoutMs;
  const ttlMs = options.cacheTtlMs ?? tutCacheTtlMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let resources = new Map<string, ResourceState>();
  let cache: SearchCacheEntry | undefined;
  let inFlight: Promise<EnemySearchData> | undefined;

  const revalidate = async (): Promise<EnemySearchData> => {
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
        if (!previous) throw new Error("Unexpected HTTP 304 without cached enemy data");
        nextResources.set(url, {
          ...previous,
          etag: response.headers.get("etag") ?? previous.etag,
          lastModified:
            response.headers.get("last-modified") ?? previous.lastModified,
        });
        return previous.text;
      }
      if (!response.ok) {
        throw new Error(`Enemy data request failed with HTTP ${response.status}`);
      }
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

    try {
      const [nameText, aliasText] = await Promise.all([
        fetchResource(urls.enemyNames),
        fetchResource(urls.aliases),
      ]);
      const aggregateHash = sha256(JSON.stringify([nameText, aliasText]));
      const value = cache?.aggregateHash === aggregateHash
        ? cache.value
        : buildEnemySearchData(
          parseEnemyNameTsv(nameText),
          parseEnemyAliasJson(aliasText),
        );
      resources = nextResources;
      cache = { value, aggregateHash, validatedAt: now() };
      return value;
    } catch (error) {
      if (!cache) throw error;
      console.error("Enemy data refresh failed; stale cache is used.", error);
      return cache.value;
    }
  };

  return {
    async fetchSearchData(): Promise<EnemySearchData> {
      if (cache && now() - cache.validatedAt < ttlMs) return cache.value;
      if (!inFlight) {
        inFlight = revalidate().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
    async fetchEnemyPng(id: number) {
      const filename = buildEnemyIconFilename(id);
      const response = await fetchWithTimeout(
        fetchImpl,
        `${urls.enemyIconsBase.replace(/\/$/, "")}/${filename}`,
        timeoutMs,
      );
      if (!response.ok) {
        throw new Error(`Enemy PNG request failed with HTTP ${response.status}`);
      }
      return {
        data: new Uint8Array(await response.arrayBuffer()),
        filename,
      };
    },
  };
}

export const remoteTutDataSource = createRemoteTutDataSource();
