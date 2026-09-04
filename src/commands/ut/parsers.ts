import {
  CharacterAssets,
  CharacterAssetUnit,
  CharacterIndex,
  CharacterUnit,
  UtOriginRequest,
  UtRequest,
} from "./types";
import { buildAssetPath, isSafeRelativePath } from "./domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedUnitId(index: number): string {
  return String(index).padStart(3, "0");
}

function parseOriginArguments(args: readonly string[]): UtOriginRequest | undefined {
  const normalized = args.map((value) => value.toLowerCase());
  if (normalized.length === 0) return { family: "icon", variant: "f" };

  const first = normalized[0];
  if (normalized.length === 1 && ["f", "c", "s", "u"].includes(first)) {
    return { family: "icon", variant: first as "f" | "c" | "s" | "u" };
  }

  if (first === "icon" || first === "wide") {
    const variant = normalized[1] ?? "f";
    if (
      normalized.length <= 2 &&
      ["f", "c", "s", "u"].includes(variant)
    ) {
      return {
        family: first,
        variant: variant as "f" | "c" | "s" | "u",
      };
    }
    return undefined;
  }

  if (first === "gacha") {
    if (normalized.length === 1) return { family: "gacha", variant: "f" };
    if (normalized.length === 2 && (normalized[1] === "m" || normalized[1] === "z")) {
      return { family: "gacha", variant: normalized[1] };
    }
  }
  return undefined;
}

export function parseUtRequest(args: readonly string[]): UtRequest {
  if (args.length === 0) return { kind: "landing" };

  const originIndex = args.findIndex((value) => value.toLowerCase() === "origin");
  const queryArguments = originIndex === -1 ? args : args.slice(0, originIndex);
  const force = queryArguments.some((value) => value.toLowerCase() === "-f");
  const query = queryArguments
    .filter((value) => value.toLowerCase() !== "-f")
    .join(" ")
    .trim();

  if (originIndex === -1) return { kind: "search", query, force };
  if (!query) return { kind: "invalid-origin" };

  const origin = parseOriginArguments(args.slice(originIndex + 1));
  return origin
    ? { kind: "search", query, force, origin }
    : { kind: "invalid-origin" };
}

function parseCharacterUnit(value: unknown, index: number): CharacterUnit {
  if (!isRecord(value) || value.id !== expectedUnitId(index)) {
    throw new Error(`Invalid character index: unit ${index} has an invalid id`);
  }
  if (!Array.isArray(value.forms) || value.forms.length < 1 || value.forms.length > 4) {
    throw new Error(`Invalid character index: unit ${value.id} forms must contain 1-4 items`);
  }
  const forms = value.forms.map((form, formIndex) => {
    if (
      !isRecord(form) ||
      typeof form.name !== "string" ||
      !form.name.trim() ||
      typeof form.description !== "string"
    ) {
      throw new Error(
        `Invalid character index: unit ${value.id} form ${formIndex} is invalid`,
      );
    }
    return { name: form.name, description: form.description };
  });
  if (
    !Array.isArray(value.aliases) ||
    value.aliases.some((alias) => typeof alias !== "string" || !alias.trim())
  ) {
    throw new Error(`Invalid character index: unit ${value.id} aliases are invalid`);
  }
  const aliases = value.aliases as string[];
  if (new Set(aliases).size !== aliases.length) {
    throw new Error(`Invalid character index: unit ${value.id} aliases contain duplicates`);
  }
  return { id: value.id, forms, aliases };
}

export function parseCharacterIndex(value: unknown): CharacterIndex {
  if (!isRecord(value) || !Array.isArray(value.units) || value.units.length === 0) {
    throw new Error("Invalid character index: units must be a non-empty array");
  }
  return { units: value.units.map(parseCharacterUnit) };
}

function parsePathTemplates(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new Error("Invalid character assets: pathTemplates must be an object");
  }
  const templates: Record<string, string> = {};
  for (const [code, template] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9]*$/i.test(code) || typeof template !== "string") {
      throw new Error("Invalid character assets: pathTemplates entry is invalid");
    }
    if (!isSafeRelativePath(template)) {
      throw new Error(`Invalid character assets: unsafe template ${code}`);
    }
    templates[code] = template;
  }
  for (const code of ["un", "uu", "g"]) {
    const template = templates[code];
    if (!template?.includes("{id}") || !template.includes("{suffix}")) {
      throw new Error(`Invalid character assets: required template ${code} is invalid`);
    }
  }
  return templates;
}

function parseAssetUnit(
  value: unknown,
  index: number,
  pathTemplates: Readonly<Record<string, string>>,
): CharacterAssetUnit {
  if (!isRecord(value) || value.id !== expectedUnitId(index)) {
    throw new Error(`Invalid character assets: unit ${index} has an invalid id`);
  }
  const suffixes: Record<string, readonly string[]> = {};
  for (const [code, rawSuffixes] of Object.entries(value)) {
    if (code === "id") continue;
    if (code === "omit") {
      if (!Array.isArray(rawSuffixes) || rawSuffixes.some((item) => typeof item !== "string")) {
        throw new Error(`Invalid character assets: unit ${value.id} omit is invalid`);
      }
      continue;
    }
    if (!pathTemplates[code] || !Array.isArray(rawSuffixes)) {
      throw new Error(`Invalid character assets: unit ${value.id} code ${code} is invalid`);
    }
    if (
      rawSuffixes.some((suffix) => typeof suffix !== "string" || !suffix) ||
      new Set(rawSuffixes).size !== rawSuffixes.length
    ) {
      throw new Error(`Invalid character assets: unit ${value.id} suffixes are invalid`);
    }
    const strings = rawSuffixes as string[];
    for (const suffix of strings) {
      buildAssetPath(pathTemplates[code], value.id, suffix);
    }
    suffixes[code] = strings;
  }
  return { id: value.id, suffixes };
}

export function parseCharacterAssets(value: unknown): CharacterAssets {
  if (!isRecord(value) || !Array.isArray(value.units) || value.units.length === 0) {
    throw new Error("Invalid character assets: units must be a non-empty array");
  }
  const pathTemplates = parsePathTemplates(value.pathTemplates);
  return {
    pathTemplates,
    units: value.units.map((unit, index) =>
      parseAssetUnit(unit, index, pathTemplates),
    ),
  };
}
