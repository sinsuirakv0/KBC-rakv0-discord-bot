import {
  EventDataCountry,
  EventDataRequest,
  EventDataType,
} from "./types";

const TYPE_ALIASES: Readonly<Record<string, EventDataType>> = {
  sale: "sale",
  gatya: "gatya",
  item: "item",
  ad: "ad",
  notice: "notice",
  popup_notice: "notice",
  placement: "notice",
};

const COUNTRY_ALIASES: Readonly<Record<string, EventDataCountry>> = {
  jp: "jp",
  ja: "jp",
  en: "en",
  kr: "kr",
  ko: "kr",
  tw: "tw",
};

export function parseEventDataRequest(args: readonly string[]): EventDataRequest {
  if (args.length === 0) return { kind: "all-links" };
  if (args[0].toLowerCase() === "all") {
    let country: EventDataCountry = "jp";
    let countrySeen = false;
    let kbc = false;
    for (const raw of args.slice(1)) {
      const value = raw.toLowerCase();
      const parsedCountry = COUNTRY_ALIASES[value];
      if (parsedCountry) {
        if (countrySeen) return { kind: "invalid" };
        country = parsedCountry;
        countrySeen = true;
      } else if (value === "kbc") {
        if (kbc) return { kind: "invalid" };
        kbc = true;
      } else {
        return { kind: "invalid" };
      }
    }
    return { kind: "all", country, kbc };
  }
  const type = TYPE_ALIASES[args[0].toLowerCase()];
  if (!type) return { kind: "invalid" };
  let country: EventDataCountry = "jp";
  let countrySeen = false;
  let file = false;
  let encrypted = false;
  let kbc = false;
  for (const raw of args.slice(1)) {
    const value = raw.toLowerCase();
    const parsedCountry = COUNTRY_ALIASES[value];
    if (parsedCountry) {
      if (countrySeen) return { kind: "invalid" };
      country = parsedCountry;
      countrySeen = true;
    } else if (value === "tsv" || value === "file") {
      if (file) return { kind: "invalid" };
      file = true;
    } else if (value === "enc") {
      if (encrypted) return { kind: "invalid" };
      encrypted = true;
    } else if (value === "kbc") {
      if (kbc) return { kind: "invalid" };
      kbc = true;
    } else {
      return { kind: "invalid" };
    }
  }
  if (encrypted && !file) return { kind: "invalid" };
  return { kind: "selected", type, country, file, encrypted, kbc };
}
