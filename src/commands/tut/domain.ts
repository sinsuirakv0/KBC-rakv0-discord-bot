import { normalizeSearchText } from "../shared/search";
import { MotionKind, MotionPlan, MotionRequest } from "../shared/motion/types";
import { buildMotionAnimationSuffix } from "../shared/motion/asset-suffix";
import { buildAssetPath } from "../ut/domain";
import { CharacterAssets } from "../ut/types";
import {
  EnemyAliasEntry,
  EnemySearchData,
  EnemySearchEntry,
  TutSearchMatch,
} from "./types";

export function buildEnemySearchData(
  displayNames: readonly (string | undefined)[],
  aliasEntries: readonly EnemyAliasEntry[],
): EnemySearchData {
  const aliasesById = new Map(aliasEntries.map((entry) => [entry.id, entry.names]));
  const entries: EnemySearchEntry[] = [];
  const idIndex = new Map<number, EnemySearchEntry>();

  for (let id = 0; id < displayNames.length; id += 1) {
    const displayName = displayNames[id];
    if (!displayName) continue;
    const aliases = [...new Set(aliasesById.get(id) ?? [])].filter(
      (alias) => alias !== displayName,
    );
    const entry = { id, displayName, aliases };
    entries.push(entry);
    idIndex.set(id, entry);
  }
  return { entries, idIndex };
}

function nameMatches(
  name: string,
  words: readonly string[],
  force: boolean,
): boolean {
  const searchableName = force ? name : normalizeSearchText(name);
  return words.every((word) => searchableName.includes(word));
}

export function searchEnemies(
  data: EnemySearchData,
  query: string,
  force: boolean,
): readonly TutSearchMatch[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  if (/^\d+$/.test(trimmedQuery)) {
    const id = Number(trimmedQuery);
    const enemy = Number.isSafeInteger(id) ? data.idIndex.get(id) : undefined;
    if (enemy) return [{ enemy }];
  }

  const words = (force ? trimmedQuery : normalizeSearchText(trimmedQuery))
    .split(/\s+/)
    .filter(Boolean);
  const matches: TutSearchMatch[] = [];
  for (const enemy of data.entries) {
    if (nameMatches(enemy.displayName, words, force)) {
      matches.push({ enemy });
      continue;
    }
    const matchedAlias = enemy.aliases.find((alias) =>
      nameMatches(alias, words, force),
    );
    if (matchedAlias) matches.push({ enemy, matchedAlias });
  }
  return matches;
}

export function resolveEnemyDisplayName(match: TutSearchMatch): string {
  if (match.enemy.displayName !== "ダミー") return match.enemy.displayName;
  const alias = match.matchedAlias ?? match.enemy.aliases.find((name) => name !== "ダミー");
  return alias && alias !== "ダミー" ? `${alias} (ダミー)` : "ダミー";
}

export function buildEnemyIconFilename(id: number): string {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid enemy ID");
  return `enemy_icon_${String(id).padStart(3, "0")}.png`;
}

export function resolveEnemyMotionPlan(
  assets: CharacterAssets,
  id: number,
  request: MotionRequest,
): MotionPlan | undefined {
  if (!Number.isSafeInteger(id) || id < 0) return undefined;
  const assetId = String(id).padStart(3, "0");
  const unit = assets.units[id];
  const template = assets.pathTemplates.i;
  if (!unit || unit.id !== assetId || !template) return undefined;
  const suffixes = unit.suffixes.i;
  if (!suffixes?.includes("_e.imgcut") || !suffixes.includes("_e.mamodel")) {
    return undefined;
  }
  const animationPaths: Partial<Record<MotionKind, string>> = {};
  for (const segment of request.segments) {
    if (animationPaths[segment.motion]) continue;
    const suffix = buildMotionAnimationSuffix("e", segment.motion);
    if (!suffixes.includes(suffix)) return undefined;
    animationPaths[segment.motion] = buildAssetPath(template, assetId, suffix);
  }
  return {
    ...request,
    filenameStem: `tut-${assetId}-motion`,
    previewScale: id === 0 ? 2.25 : 1,
    spritePath: `Number/${assetId}_e.png`,
    imgcutPath: buildAssetPath(template, assetId, "_e.imgcut"),
    modelPath: buildAssetPath(template, assetId, "_e.mamodel"),
    animationPaths,
  };
}
