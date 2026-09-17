import {
  CharacterIndex,
  CharacterUnit,
  UnitBuy,
  UtFileOption,
  UtForm,
  UtMatchSource,
  UtMotionAssetPlan,
  UtMotionKind,
  UtMotionRequest,
  UtOriginRequest,
  UtSearchMatch,
} from "./types";
import { normalizeSearchText } from "../shared/search";
import { buildMotionAnimationSuffix } from "../shared/motion/asset-suffix";

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

export function resolveOriginAssetPath(
  unitBuy: UnitBuy,
  id: string,
  origin: UtOriginRequest,
): string | undefined {
  if (origin.family === "gacha") {
    return `Image/gatyachara_${id}_${origin.variant}.png`;
  }

  const form = origin.variant as UtForm;
  const stem = resolveUnitAssetStem(unitBuy, id, form);
  if (!stem) return undefined;
  if (origin.family === "sprite") {
    return `Number/${stem.assetId}_${stem.suffix}.png`;
  }

  const suffix = stem.shared
    ? `_m0${form === "f" ? 0 : 1}.png`
    : origin.family === "icon" ? `_${form}00.png` : `_${form}.png`;
  const prefix = origin.family === "icon" ? "uni" : "udi";
  return `Unit/${prefix}${stem.assetId}${suffix}`;
}

const FORMS: readonly UtForm[] = ["f", "c", "s", "u"];
const FORM_LABELS: Readonly<Record<UtForm, string>> = {
  f: "第一形態",
  c: "第二形態",
  s: "第三形態",
  u: "第四形態",
};

export function resolveCharacterFileOptions(
  unit: CharacterUnit,
  unitBuy: UnitBuy,
  formFilter?: UtForm,
): readonly UtFileOption[] {
  const options: UtFileOption[] = [];
  const forms = FORMS.slice(0, unit.forms.length).filter(
    (form) => !formFilter || form === formFilter,
  );
  for (const form of forms) {
    const stem = resolveUnitAssetStem(unitBuy, unit.id, form);
    if (!stem) continue;
    const label = FORM_LABELS[form];
    const sharedSuffix = `_m0${form === "f" ? 0 : 1}.png`;
    const iconSuffix = stem.shared ? sharedSuffix : `_${form}00.png`;
    const wideSuffix = stem.shared ? sharedSuffix : `_${form}.png`;
    const base = `${stem.assetId}_${stem.suffix}`;
    options.push(
      { relativePath: `Unit/uni${stem.assetId}${iconSuffix}`, label: `${label} アイコン` },
      { relativePath: `Unit/udi${stem.assetId}${wideSuffix}`, label: `${label} 横長画像` },
      { relativePath: `Number/${base}.png`, label: `${label} スプライト` },
      { relativePath: `ImageData/${base}.imgcut`, label: `${label} 切り抜き情報` },
      { relativePath: `ImageData/${base}.mamodel`, label: `${label} モデル` },
      { relativePath: `ImageData/${base}00.maanim`, label: `${label} 歩行` },
      { relativePath: `ImageData/${base}01.maanim`, label: `${label} 待機` },
      { relativePath: `ImageData/${base}02.maanim`, label: `${label} 攻撃` },
      { relativePath: `ImageData/${base}03.maanim`, label: `${label} ノックバック` },
    );
  }
  if (!formFilter) {
    for (const variant of ["f", "m", "z"] as const) {
      options.push({
        relativePath: `Image/gatyachara_${unit.id}_${variant}.png`,
        label: `ガチャ画像 ${variant}`,
      });
    }
  }
  return options;
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

export function resolveMotionAssetPlan(
  unitBuy: UnitBuy,
  id: string,
  request: UtMotionRequest,
): UtMotionAssetPlan | undefined {
  const stem = resolveUnitAssetStem(unitBuy, id, request.form);
  if (!stem) return undefined;

  const imgcutSuffix = `_${stem.suffix}.imgcut`;
  const modelSuffix = `_${stem.suffix}.mamodel`;

  const animationPaths: Partial<Record<UtMotionKind, string>> = {};
  for (const segment of request.segments) {
    if (animationPaths[segment.motion]) continue;
    const suffix = buildMotionAnimationSuffix(stem.suffix, segment.motion);
    animationPaths[segment.motion] = `ImageData/${stem.assetId}${suffix}`;
  }

  return {
    id,
    form: request.form,
    format: request.format,
    full: request.full,
    filenameStem: `ut-${id}-${request.form}-motion`,
    previewScale: id === "000" && request.form === "f" ? 2.25
      : id === "009" && request.form === "f" ? 0.82 : 1,
    segments: request.segments,
    spritePath: `Number/${stem.assetId}_${stem.suffix}.png`,
    imgcutPath: `ImageData/${stem.assetId}${imgcutSuffix}`,
    modelPath: `ImageData/${stem.assetId}${modelSuffix}`,
    animationPaths,
  };
}
