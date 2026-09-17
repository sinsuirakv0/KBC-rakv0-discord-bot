import {
  CharacterIndex,
  CharacterUnit,
  UnitBuy,
  UtForm,
  UtMotionRequest,
  UtOriginRequest,
  UtRequest,
} from "./types";
import { parseMotionArguments as parseMotionOptions } from "../shared/motion/parser";

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

  if (first === "icon" || first === "wide" || first === "sprite") {
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

function parseMotionArguments(args: readonly string[]): UtMotionRequest | undefined {
  const request = parseMotionOptions(args, ["f", "c", "s", "u"]);
  return request ? { ...request, form: (request.form ?? "f") as UtForm } : undefined;
}

export function parseUtRequest(args: readonly string[]): UtRequest {
  if (args.length === 0) return { kind: "landing" };

  const normalized = args.map((value) => value.toLowerCase());
  const originIndex = normalized.indexOf("origin");
  const fileIndex = normalized.indexOf("file");
  const motionIndex = normalized.indexOf("motion");
  const operations = [originIndex, fileIndex, motionIndex].filter((index) => index !== -1);
  if (operations.length > 1) {
    const firstIndex = Math.min(...operations);
    return firstIndex === fileIndex
      ? { kind: "invalid-file" }
      : firstIndex === motionIndex
        ? { kind: "invalid-motion" }
        : { kind: "invalid-origin" };
  }

  const operationIndex = operations[0] ?? -1;
  const queryArguments = operationIndex === -1 ? args : args.slice(0, operationIndex);
  const force = queryArguments.some((value) => value.toLowerCase() === "-f");
  const query = queryArguments
    .filter((value) => value.toLowerCase() !== "-f")
    .join(" ")
    .trim();

  if (operationIndex === -1) return { kind: "search", query, force };
  if (!query) {
    return fileIndex !== -1
      ? { kind: "invalid-file" }
      : motionIndex !== -1
        ? { kind: "invalid-motion" }
        : { kind: "invalid-origin" };
  }

  if (motionIndex !== -1) {
    const motion = parseMotionArguments(args.slice(motionIndex + 1));
    return motion
      ? { kind: "search", query, force, motion }
      : { kind: "invalid-motion" };
  }

  if (fileIndex !== -1) {
    const fileArguments = args.slice(fileIndex + 1).map((value) => value.toLowerCase());
    if (fileArguments.length === 0) {
      return { kind: "search", query, force, file: {} };
    }
    const form = fileArguments[0];
    return fileArguments.length === 1 && ["f", "c", "s", "u"].includes(form)
      ? { kind: "search", query, force, file: { form: form as UtForm } }
      : { kind: "invalid-file" };
  }

  const origin = parseOriginArguments(args.slice(originIndex + 1));
  return origin
    ? { kind: "search", query, force, origin }
    : { kind: "invalid-origin" };
}

export function parseUnitBuy(text: string): UnitBuy {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("Invalid unitbuy.csv: no rows");

  return {
    units: lines.map((line, index) => {
      const columns = line.split(",");
      if (columns.length < 63) {
        throw new Error(`Invalid unitbuy.csv: row ${index} has too few columns`);
      }
      const sharedFormIds = [columns[61], columns[62]].map((value, formIndex) => {
        if (!/^-?\d+$/.test(value)) {
          throw new Error(`Invalid unitbuy.csv: row ${index} form ${formIndex} is invalid`);
        }
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id < -1) {
          throw new Error(`Invalid unitbuy.csv: row ${index} form ${formIndex} is invalid`);
        }
        return id === -1 ? undefined : String(id).padStart(3, "0");
      }) as [string | undefined, string | undefined];
      return { id: expectedUnitId(index), sharedFormIds };
    }),
  };
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
