import {
  CharacterAssets,
  CharacterIndex,
  CharacterUnit,
  UtMatchSource,
  UtOriginRequest,
  UtSearchMatch,
} from "./types";
import { normalizeSearchText } from "../shared/search";

export { normalizeSearchText };

function findNameMatch(
  unit: CharacterUnit,
  words: readonly string[],
  force: boolean,
): UtMatchSource | undefined {
  for (let formIndex = 0; formIndex < unit.forms.length; formIndex += 1) {
    const rawName = unit.forms[formIndex].name;
    const name = force ? rawName : normalizeSearchText(rawName);
    if (words.every((word) => name.includes(word))) {
      return { kind: "form", formIndex };
    }
  }
  if (!force) {
    for (const rawAlias of unit.aliases) {
      const alias = normalizeSearchText(rawAlias);
      if (words.every((word) => alias.includes(word))) return { kind: "alias" };
    }
  }
  return undefined;
}

export function searchCharacterIndex(
  index: CharacterIndex,
  query: string,
  force: boolean,
): readonly UtSearchMatch[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  if (!force && /^\d+$/.test(trimmedQuery)) {
    const numericId = Number(trimmedQuery);
    const unit = Number.isSafeInteger(numericId) ? index.units[numericId] : undefined;
    if (unit && Number(unit.id) === numericId) return [{ unit, source: { kind: "id" } }];
  }

  const words = (force ? trimmedQuery : normalizeSearchText(trimmedQuery))
    .split(/\s+/)
    .filter(Boolean);
  const matches: UtSearchMatch[] = [];
  for (const unit of index.units) {
    const source = findNameMatch(unit, words, force);
    if (source) matches.push({ unit, source });
  }
  return matches.sort((left, right) => Number(left.unit.id) - Number(right.unit.id));
}

export function isSafeRelativePath(value: string): boolean {
  if (
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f]/.test(value) ||
    /[?#%]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

export function buildAssetPath(template: string, id: string, suffix: string): string {
  const relativePath = template
    .split("{id}").join(id)
    .split("{suffix}").join(suffix);
  if (relativePath.includes("{") || !isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe character asset path: ${relativePath}`);
  }
  return relativePath;
}

export function resolveOriginAssetPath(
  assets: CharacterAssets,
  id: string,
  origin: UtOriginRequest,
): string | undefined {
  const numericId = Number(id);
  const unit = Number.isSafeInteger(numericId) ? assets.units[numericId] : undefined;
  if (!unit || unit.id !== id) return undefined;

  const code = origin.family === "icon" ? "un" : origin.family === "wide" ? "uu" : "g";
  const suffix =
    origin.family === "icon"
      ? `_${origin.variant}00.png`
      : `_${origin.variant}.png`;
  if (!unit.suffixes[code]?.includes(suffix)) return undefined;

  const template = assets.pathTemplates[code];
  return template ? buildAssetPath(template, id, suffix) : undefined;
}
