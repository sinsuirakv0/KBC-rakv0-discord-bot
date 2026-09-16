import { createHmac, randomBytes } from "node:crypto";
import {
  eventDataCredentialTtlMs,
  eventDataHttpTimeoutMs,
  eventDataMaxBytes,
} from "../../config/eventdata";
import {
  buildKbcEventDataUrl,
  buildOfficialEventDataUrl,
  encryptEventData,
  eventDataFileInfo,
  needsEventJwt,
  validateEventData,
} from "./domain";
import {
  EventDataCountry,
  EventDataDataSource,
  EventDataRequest,
  EventDataType,
} from "./types";

const USER_AGENT = "Dalvik/2.1.0 (Linux; Android 9; SM-G955F Build/N2G48B)";

export interface RemoteEventDataSourceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  credentialTtlMs?: number;
  maxBytes?: number;
  now?: () => number;
}

function createSignature(accountCode: string, body: string): string {
  const randomData = randomBytes(32).toString("hex");
  return randomData + createHmac("sha256", accountCode + randomData)
    .update(body).digest("hex");
}

export function createRemoteEventDataSource(
  options: RemoteEventDataSourceOptions = {},
): EventDataDataSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? eventDataHttpTimeoutMs;
  const credentialTtlMs = options.credentialTtlMs ?? eventDataCredentialTtlMs;
  const maxBytes = options.maxBytes ?? eventDataMaxBytes;
  const now = options.now ?? Date.now;
  let credential: { token: string; createdAt: number } | undefined;
  let credentialRequest: Promise<string> | undefined;

  const consumeResponse = async <T>(
    url: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      return await consume(response);
    } finally {
      clearTimeout(timeout);
    }
  };

  const fetchJson = async (url: string, init: RequestInit = {}): Promise<unknown> => {
    return consumeResponse(url, init, async (response) => {
      if (!response.ok) throw new Error(`Event authentication failed (${response.status})`);
      return response.json() as Promise<unknown>;
    });
  };

  const issueToken = async (): Promise<string> => {
    const account = await fetchJson(
      "https://nyanko-backups.ponosgames.com/?action=createAccount&referenceId=",
    ) as { accountId?: unknown };
    const accountCode = typeof account.accountId === "string" ? account.accountId : "";
    if (!accountCode) throw new Error("Event account response is invalid");
    const timestamp = Math.floor(now() / 1000);
    const headers = (body: string): HeadersInit => ({
      "Content-Type": "application/json",
      "Nyanko-Signature": createSignature(accountCode, body),
      "Nyanko-Timestamp": String(timestamp),
      "Nyanko-Signature-Version": "1",
      "Nyanko-Signature-Algorithm": "HMACSHA256",
    });
    const userBody = JSON.stringify({
      accountCode,
      accountCreatedAt: String(timestamp),
      nonce: randomBytes(16).toString("hex"),
    });
    const user = await fetchJson("https://nyanko-auth.ponosgames.com/v1/users", {
      method: "POST", headers: headers(userBody), body: userBody,
    }) as { payload?: { password?: unknown } };
    const password = typeof user.payload?.password === "string"
      ? user.payload.password : "";
    if (!password) throw new Error("Event user response is invalid");
    const tokenBody = JSON.stringify({
      clientInfo: {
        client: { countryCode: "ja", version: "999999" },
        device: { model: "ONEPLUS A3010" },
        os: { type: "android", version: "7.1.1" },
      },
      password,
      accountCode,
      nonce: randomBytes(16).toString("hex"),
    });
    const token = await fetchJson("https://nyanko-auth.ponosgames.com/v1/tokens", {
      method: "POST", headers: headers(tokenBody), body: tokenBody,
    }) as { payload?: { token?: unknown } };
    const value = typeof token.payload?.token === "string" ? token.payload.token : "";
    if (!value) throw new Error("Event token response is invalid");
    return value;
  };

  const getToken = async (): Promise<string> => {
    if (credential && now() - credential.createdAt < credentialTtlMs) {
      return credential.token;
    }
    if (!credentialRequest) {
      credentialRequest = issueToken().then((token) => {
        credential = { token, createdAt: now() };
        return token;
      }).finally(() => {
        credentialRequest = undefined;
      });
    }
    return credentialRequest;
  };

  const officialLinks = async (
    types: readonly EventDataType[],
    country: EventDataCountry,
  ): Promise<ReadonlyMap<EventDataType, string>> => {
    const token = types.some(needsEventJwt) ? await getToken() : undefined;
    return new Map(types.map((type) => {
      const url = buildOfficialEventDataUrl(type, country, token);
      if (!url) throw new Error("Official event URL could not be created");
      return [type, url];
    }));
  };

  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    return consumeResponse(url, {}, async (response) => {
      if (!response.ok) throw new Error(`Event data request failed (${response.status})`);
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error("Event data response is too large");
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > maxBytes) throw new Error("Event data response is too large");
      return data;
    });
  };

  return {
    fetchOfficialLinks: officialLinks,
    async fetchAttachment(
      request: Extract<EventDataRequest, { kind: "selected" }>,
    ) {
      const fileInfo = eventDataFileInfo[request.type];
      if (request.kbc) {
        const data = await fetchBytes(buildKbcEventDataUrl(
          request.type,
          request.country,
          request.encrypted,
        ));
        if (!request.encrypted) validateEventData(request.type, data);
        return {
          data,
          filename: request.encrypted ? fileInfo.encrypted : fileInfo.plain,
        };
      }
      const links = await officialLinks([request.type], request.country);
      const url = links.get(request.type);
      if (!url) throw new Error("Official event URL is unavailable");
      const data = await fetchBytes(url);
      validateEventData(request.type, data);
      return {
        data: request.encrypted ? encryptEventData(data, request.country) : data,
        filename: request.encrypted ? fileInfo.encrypted : fileInfo.plain,
      };
    },
  };
}

export const remoteEventDataSource = createRemoteEventDataSource();
