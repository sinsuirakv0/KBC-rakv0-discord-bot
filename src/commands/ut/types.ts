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

export interface UnitBuyEntry {
  id: string;
  sharedFormIds: readonly [string | undefined, string | undefined];
}

export interface UnitBuy {
  units: readonly UnitBuyEntry[];
}

export type UtMatchSource =
  | { kind: "id" }
  | { kind: "form"; formIndex: number }
  | { kind: "alias" };

export interface UtSearchMatch {
  unit: CharacterUnit;
  source: UtMatchSource;
}

export type UtForm = "f" | "c" | "s" | "u";
export type UtOriginFamily = "icon" | "wide" | "gacha" | "sprite";
export type UtOriginVariant = "f" | "c" | "s" | "u" | "m" | "z";

export interface UtOriginRequest {
  family: UtOriginFamily;
  variant: UtOriginVariant;
}

export type UtMotionFormat = "png" | "mp4" | "gif";
export type UtMotionKind = "attack" | "move" | "idle" | "knockback";

export interface UtMotionSegment {
  motion: UtMotionKind;
  range?: { start: number; end: number };
  frame?: number;
}

export interface UtMotionRequest {
  format: UtMotionFormat;
  form: UtForm;
  segments: readonly UtMotionSegment[];
}

export interface UtMotionAssetPlan {
  id: string;
  form: UtForm;
  format: UtMotionFormat;
  segments: readonly UtMotionSegment[];
  spritePath: string;
  imgcutPath: string;
  modelPath: string;
  animationPaths: Readonly<Partial<Record<UtMotionKind, string>>>;
}

export interface UtMotionRenderer {
  render(
    plan: UtMotionAssetPlan,
    fetchAsset: (relativePath: string) => Promise<Uint8Array>,
    onProgress?: (progress: UtMotionProgress) => void,
  ): Promise<CommandAttachment | undefined>;
}

export type UtMotionProgress =
  | { stage: "queued" | "loading" | "encoding" | "sending" }
  | { stage: "rendering"; completedFrames: number; totalFrames: number };

export interface UtMotionAssets {
  sprite: Uint8Array;
  imgcut: Uint8Array;
  model: Uint8Array;
  animations: Readonly<Partial<Record<UtMotionKind, Uint8Array>>>;
}

export interface UtMotionWorkerInput {
  plan: UtMotionAssetPlan;
  assets: UtMotionAssets;
}

export type UtMotionWorkerMessage =
  | { kind: "ready" | "invalid" }
  | { kind: "progress"; progress: UtMotionProgress }
  | { kind: "result"; data: Uint8Array };

export type UtRequest =
  | { kind: "landing" }
  | { kind: "invalid-origin" }
  | { kind: "invalid-motion" }
  | {
      kind: "search";
      query: string;
      force: boolean;
      origin?: UtOriginRequest;
      motion?: UtMotionRequest;
    };

export interface UtDataSource {
  fetchCharacterIndex(): Promise<CharacterIndex>;
  fetchCharacterAssets(): Promise<CharacterAssets>;
  fetchUnitBuy(): Promise<UnitBuy>;
  fetchAsset(relativePath: string): Promise<Uint8Array>;
  fetchPng(relativePath: string): Promise<CommandAttachment>;
}
