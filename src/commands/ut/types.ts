import { CommandAttachment } from "../types";

export interface CharacterForm {
  name: string;
  description: string;
}

export interface CharacterUnit {
  id: string;
  forms: readonly CharacterForm[];
  aliases: readonly string[];
}

export interface CharacterIndex {
  units: readonly CharacterUnit[];
}

export interface CharacterAssetUnit {
  id: string;
  suffixes: Readonly<Record<string, readonly string[]>>;
}

export interface CharacterAssets {
  pathTemplates: Readonly<Record<string, string>>;
  units: readonly CharacterAssetUnit[];
}

export type UtMatchSource =
  | { kind: "id" }
  | { kind: "form"; formIndex: number }
  | { kind: "alias" };

export interface UtSearchMatch {
  unit: CharacterUnit;
  source: UtMatchSource;
}

export type UtOriginFamily = "icon" | "wide" | "gacha";
export type UtOriginVariant = "f" | "c" | "s" | "u" | "m" | "z";

export interface UtOriginRequest {
  family: UtOriginFamily;
  variant: UtOriginVariant;
}

export type UtRequest =
  | { kind: "landing" }
  | { kind: "invalid-origin" }
  | {
      kind: "search";
      query: string;
      force: boolean;
      origin?: UtOriginRequest;
    };

export interface UtDataSource {
  fetchCharacterIndex(): Promise<CharacterIndex>;
  fetchCharacterAssets(): Promise<CharacterAssets>;
  fetchPng(relativePath: string): Promise<CommandAttachment>;
}
