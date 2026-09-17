import { CommandAttachment } from "../types";
import { MotionRequest } from "../shared/motion/types";
import { AssetFileOption } from "../shared/file-picker";

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
  | { kind: "invalid-file" }
  | { kind: "invalid-motion" }
  | {
      kind: "search";
      query: string;
      force: boolean;
      origin: boolean;
      file?: true;
      motion?: MotionRequest;
    };

export interface TutDataSource {
  fetchSearchData(): Promise<EnemySearchData>;
  fetchEnemyPng(id: number): Promise<CommandAttachment>;
  findExistingAssets(relativePaths: readonly string[]): Promise<ReadonlySet<string>>;
  fetchFile(relativePath: string): Promise<CommandAttachment>;
  fetchMotionAsset(relativePath: string): Promise<Uint8Array>;
}

export type TutFileOption = AssetFileOption;
