import { createCipheriv, createHash } from "node:crypto";
import {
  eventDataKbcOrigin,
  eventDataOfficialOrigin,
} from "../../config/eventdata";
import {
  EventDataCountry,
  EventDataFileInfo,
  EventDataType,
} from "./types";

const REGION_INFO: Readonly<Record<EventDataCountry, {
  product: string;
  eventBase: string;
  salt: string;
}>> = {
  jp: { product: "battlecats", eventBase: "battlecats_production", salt: "battlecats" },
  en: { product: "battlecatsen", eventBase: "battlecatsen_production", salt: "battlecatsen" },
  kr: { product: "battlecatskr", eventBase: "battlecatskr_production", salt: "battlecatskr" },
  tw: { product: "battlecatstw", eventBase: "battlecatstw_production", salt: "battlecatstw" },
};

export const eventDataFileInfo: Readonly<Record<EventDataType, EventDataFileInfo>> = {
  sale: { plain: "sale.tsv", encrypted: "002a4b18244f32d7833fd81bc833b97f.dat" },
  gatya: { plain: "gatya.tsv", encrypted: "09b1058188348630d98a08e0f731f6bd.dat" },
  item: { plain: "item.tsv", encrypted: "408f66def075926baea9466e70504a3b.dat" },
  ad: { plain: "ad.json", encrypted: "523af537946b79c4f8369ed39ba78605.dat" },
  notice: { plain: "popup_notice.json", encrypted: "e4698396f16e151d6634fee4dfa32741.dat" },
};

export function buildOfficialEventDataUrl(
  type: EventDataType,
  country: EventDataCountry,
  jwt?: string,
): string | undefined {
  const region = REGION_INFO[country];
  if (type === "ad") {
    return `${eventDataOfficialOrigin}/control/ad/battlecats/adcontrol.json`;
  }
  if (type === "notice") {
    return `${eventDataOfficialOrigin}/control/placement/${region.product}/event.json`;
  }
  if (!jwt) return undefined;
  return `${eventDataOfficialOrigin}/${region.eventBase}/${type}.tsv?jwt=${encodeURIComponent(jwt)}`;
}

export function buildKbcEventDataUrl(
  type: EventDataType,
  country: EventDataCountry,
  encrypted = false,
): string {
  const region = REGION_INFO[country];
  const path = type === "ad"
    ? "control/ad/battlecats/adcontrol.json"
    : type === "notice"
      ? `control/placement/${region.product}/event.json`
      : `${region.eventBase}/${type}.tsv`;
  return `${eventDataKbcOrigin}/nyanko-events/${path}${encrypted ? "?enc=1" : ""}`;
}

export function encryptEventData(
  value: Uint8Array,
  country: EventDataCountry,
): Uint8Array {
  const key = createHash("md5").update("battlecats").digest("hex").slice(0, 16);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  const signature = createHash("md5")
    .update(Buffer.concat([Buffer.from(REGION_INFO[country].salt), ciphertext]))
    .digest("hex");
  return new Uint8Array(Buffer.concat([ciphertext, Buffer.from(signature, "ascii")]));
}

export function validateEventData(type: EventDataType, value: Uint8Array): void {
  if (value.byteLength === 0) throw new Error("Event data response is empty");
  const text = Buffer.from(value).toString("utf8").replace(/^\uFEFF/, "");
  if (type === "ad" || type === "notice") {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Event JSON response is invalid");
    }
  } else if (!text.includes("\t")) {
    throw new Error("Event TSV response is invalid");
  }
}

export function needsEventJwt(type: EventDataType): boolean {
  return type === "sale" || type === "gatya" || type === "item";
}
