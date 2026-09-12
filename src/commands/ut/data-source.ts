import { createHash } from "node:crypto";
import {
  utCacheTtlMs,
  utDataUrls,
  UtDataUrls,
  utHttpTimeoutMs,
} from "../../config/ut";
import { isSafeRelativePath } from "./domain";
import { parseCharacterAssets, parseCharacterIndex, parseUnitBuy } from "./parsers";
import { CharacterAssets, CharacterIndex, UnitBuy, UtDataSource } from "./types";

interface CacheEntry<T> {
  value: T;
  hash: string;
  etag?: string;
  lastModified?: string;
  validatedAt: number;
}

interface CachedResourceOptions<T> {
  label: string;
  url: string;
  timeoutMs: number;
  ttlMs: number;
  fetchImpl: typeof fetch;
  now(): number;
  parse(text: string): T;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid ${label}: response is not JSON`);
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function createCachedResource<T>(
  options: CachedResourceOptions<T>,
): () => Promise<T> {
  let cache: CacheEntry<T> | undefined;
  let inFlight: Promise<T> | undefined;

  const revalidate = async (): Promise<T> => {
    const headers = new Headers();
    if (cache?.etag) headers.set("If-None-Match", cache.etag);
    if (cache?.lastModified) headers.set("If-Modified-Since", cache.lastModified);

    try {
      const response = await fetchWithTimeout(
        options.fetchImpl,
        options.url,
        options.timeoutMs,
        { headers },
      );
      if (response.status === 304 && cache) {
        cache = {
          ...cache,
          etag: response.headers.get("etag") ?? cache.etag,
          lastModified:
            response.headers.get("last-modified") ?? cache.lastModified,
          validatedAt: options.now(),
        };
        return cache.value;
      }
      if (!response.ok) {
        throw new Error(`${options.label} request failed with HTTP ${response.status}`);
      }

      const text = await response.text();
      const hash = createHash("sha256").update(text).digest("hex");
      const etag = response.headers.get("etag") ?? undefined;
      const lastModified = response.headers.get("last-modified") ?? undefined;
      if (cache && cache.hash === hash) {
        cache = {
          ...cache,
          etag,
          lastModified,
          validatedAt: options.now(),
        };
        return cache.value;
      }

      const value = options.parse(text);
      cache = {
        value,
        hash,
        etag,
        lastModified,
        validatedAt: options.now(),
      };
      return value;
    } catch (error) {
      if (!cache) throw error;
      console.error(`${options.label} refresh failed; stale cache is used.`, error);
      return cache.value;
    }
  };

  return async (): Promise<T> => {
    if (cache && options.now() - cache.validatedAt < options.ttlMs) {
      return cache.value;
    }
    if (!inFlight) {
      inFlight = revalidate().finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  };
}

export interface RemoteUtDataSourceOptions {
  urls?: UtDataUrls;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createRemoteUtDataSource(
  options: RemoteUtDataSourceOptions = {},
): UtDataSource {
  const urls = options.urls ?? utDataUrls;
  const timeoutMs = options.timeoutMs ?? utHttpTimeoutMs;
  const ttlMs = options.cacheTtlMs ?? utCacheTtlMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const fetchCharacterIndex = createCachedResource<CharacterIndex>({
    label: "character-index.json",
    url: urls.characterIndex,
    timeoutMs,
    ttlMs,
    fetchImpl,
    now,
    parse: (text) => parseCharacterIndex(parseJson(text, "character-index.json")),
  });
  const fetchCharacterAssets = createCachedResource<CharacterAssets>({
    label: "character-assets.json",
    url: urls.characterAssets,
    timeoutMs,
    ttlMs,
    fetchImpl,
    now,
    parse: (text) => parseCharacterAssets(parseJson(text, "character-assets.json")),
  });
  const fetchUnitBuy = createCachedResource<UnitBuy>({
    label: "unitbuy.csv",
    url: urls.unitBuy,
    timeoutMs,
    ttlMs,
    fetchImpl,
    now,
    parse: parseUnitBuy,
  });

  const fetchAsset = async (relativePath: string): Promise<Uint8Array> => {
    if (
      !isSafeRelativePath(relativePath) ||
      !/\.(?:png|imgcut|mamodel|maanim)$/i.test(relativePath)
    ) {
      throw new Error("Unsafe character asset path");
    }
    const encodedPath = relativePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const response = await fetchWithTimeout(
      fetchImpl,
      `${urls.siteDataBase.replace(/\/$/, "")}/${encodedPath}`,
      timeoutMs,
    );
    if (!response.ok) {
      throw new Error(`Character asset request failed with HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  };

  return {
    fetchCharacterIndex,
    fetchCharacterAssets,
    fetchUnitBuy,
    fetchAsset,
    async fetchPng(relativePath) {
      if (!isSafeRelativePath(relativePath) || !relativePath.endsWith(".png")) {
        throw new Error("Unsafe character PNG path");
      }
      return {
        data: await fetchAsset(relativePath),
        filename: relativePath.split("/").at(-1) ?? "origin.png",
      };
    },
  };
}

export const remoteUtDataSource = createRemoteUtDataSource();
