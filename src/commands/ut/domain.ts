import {
  CharacterAssets,
  CharacterIndex,
  CharacterUnit,
  UnitBuy,
  UtForm,
  UtMatchSource,
  UtMotionAssetPlan,
  UtMotionKind,
  UtMotionRequest,
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
  unitBuy: UnitBuy,
  id: string,
  origin: UtOriginRequest,
): string | undefined {
  if (origin.family === "gacha") {
    const numericId = Number(id);
    const unit = Number.isSafeInteger(numericId) ? assets.units[numericId] : undefined;
    const suffix = `_${origin.variant}.png`;
    if (!unit || unit.id !== id || !unit.suffixes.g?.includes(suffix)) return undefined;
    const template = assets.pathTemplates.g;
    return template ? buildAssetPath(template, id, suffix) : undefined;
  }

  const form = origin.variant as UtForm;
  const stem = resolveUnitAssetStem(unitBuy, id, form);
  if (!stem) return undefined;
  const numericAssetId = Number(stem.assetId);
  const unit = assets.units[numericAssetId];
  if (!unit || unit.id !== stem.assetId) return undefined;

  if (origin.family === "sprite") {
    if (
      !unit.suffixes.i?.includes(`_${stem.suffix}.imgcut`) ||
      !unit.suffixes.i?.includes(`_${stem.suffix}.mamodel`)
    ) {
      return undefined;
    }
    return `Number/${stem.assetId}_${stem.suffix}.png`;
  }

  const code = origin.family === "icon" ? "un" : "uu";
  const suffix = stem.shared
    ? `_m0${form === "f" ? 0 : 1}.png`
    : origin.family === "icon" ? `_${form}00.png` : `_${form}.png`;
  if (!unit.suffixes[code]?.includes(suffix)) return undefined;

  const template = assets.pathTemplates[code];
  return template ? buildAssetPath(template, stem.assetId, suffix) : undefined;
}

interface UnitAssetStem {
  assetId: string;
  suffix: UtForm | "m";
  shared: boolean;
}

export function resolveUnitAssetStem(
  unitBuy: UnitBuy,
  id: string,
  form: UtForm,
): UnitAssetStem | undefined {
  const numericId = Number(id);
  const entry = Number.isSafeInteger(numericId) ? unitBuy.units[numericId] : undefined;
  if (!entry || entry.id !== id) return undefined;

  const formIndex = form === "f" ? 0 : form === "c" ? 1 : undefined;
  const sharedId = formIndex === undefined ? undefined : entry.sharedFormIds[formIndex];
  return sharedId
    ? { assetId: sharedId, suffix: "m", shared: true }
    : { assetId: id, suffix: form, shared: false };
}

const MOTION_FILE_INDEX: Readonly<Record<UtMotionKind, number>> = {
  move: 0,
  idle: 1,
  attack: 2,
  knockback: 3,
};

export function resolveMotionAssetPlan(
  assets: CharacterAssets,
  unitBuy: UnitBuy,
  id: string,
  request: UtMotionRequest,
): UtMotionAssetPlan | undefined {
  const stem = resolveUnitAssetStem(unitBuy, id, request.form);
  if (!stem) return undefined;
  const unit = assets.units[Number(stem.assetId)];
  const template = assets.pathTemplates.i;
  if (!unit || unit.id !== stem.assetId || !template) return undefined;

  const imgcutSuffix = `_${stem.suffix}.imgcut`;
  const modelSuffix = `_${stem.suffix}.mamodel`;
  if (
    !unit.suffixes.i?.includes(imgcutSuffix) ||
    !unit.suffixes.i?.includes(modelSuffix)
  ) {
    return undefined;
  }

  const animationPaths: Partial<Record<UtMotionKind, string>> = {};
  for (const segment of request.segments) {
    if (animationPaths[segment.motion]) continue;
    const suffix = `_${stem.suffix}0${MOTION_FILE_INDEX[segment.motion]}.maanim`;
    if (!unit.suffixes.i?.includes(suffix)) return undefined;
    animationPaths[segment.motion] = buildAssetPath(template, stem.assetId, suffix);
  }

  return {
    id,
    form: request.form,
    format: request.format,
    segments: request.segments,
    spritePath: `Number/${stem.assetId}_${stem.suffix}.png`,
    imgcutPath: buildAssetPath(template, stem.assetId, imgcutSuffix),
    modelPath: buildAssetPath(template, stem.assetId, modelSuffix),
    animationPaths,
  };
}
