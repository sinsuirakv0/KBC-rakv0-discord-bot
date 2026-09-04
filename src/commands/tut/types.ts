import { CommandAttachment } from "../types";

export interface EnemyAliasEntry {
  id: number;
  names: readonly string[];
}

export interface EnemySearchEntry {
  id: number;
  displayName: string;
  aliases: readonly string[];
}

export interface EnemySearchData {
  entries: readonly EnemySearchEntry[];
  idIndex: ReadonlyMap<number, EnemySearchEntry>;
}

export interface TutSearchMatch {
  enemy: EnemySearchEntry;
  matchedAlias?: string;
}

export type TutRequest =
  | { kind: "landing" }
  | { kind: "help" }
  | { kind: "search"; query: string; force: boolean; origin: boolean };

export interface TutDataSource {
  fetchSearchData(): Promise<EnemySearchData>;
  fetchEnemyPng(id: number): Promise<CommandAttachment>;
}
