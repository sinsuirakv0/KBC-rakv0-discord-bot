import { CommandAttachment } from "../types";
import { MotionRequest } from "../shared/motion/types";
import { CharacterAssets } from "../ut/types";

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
  | { kind: "invalid-motion" }
  | { kind: "search"; query: string; force: boolean; origin: boolean; motion?: MotionRequest };

export interface TutDataSource {
  fetchSearchData(): Promise<EnemySearchData>;
  fetchEnemyPng(id: number): Promise<CommandAttachment>;
  fetchEnemyMotionAssets(): Promise<CharacterAssets>;
  fetchMotionAsset(relativePath: string): Promise<Uint8Array>;
}
