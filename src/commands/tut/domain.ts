import { normalizeSearchText } from "../shared/search";
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
