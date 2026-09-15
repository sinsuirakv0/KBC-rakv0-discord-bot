import { CommandAttachment } from "../types";
import {
  MotionAssets,
  MotionDrawPacket,
  MotionFormat,
  MotionKind,
  MotionPlan,
  MotionProgress,
  MotionRenderer,
  MotionRequest,
  MotionSegment,
  MotionWorkerInput,
  MotionWorkerMessage,
} from "../shared/motion/types";

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

export type UtMotionFormat = MotionFormat;
export type UtMotionKind = MotionKind;
export type UtMotionSegment = MotionSegment;

export interface UtMotionRequest extends MotionRequest {
  form: UtForm;
}

export interface UtMotionAssetPlan extends MotionPlan {
  id: string;
  form: UtForm;
}

export type UtMotionRenderer = MotionRenderer;
export type UtMotionProgress = MotionProgress;
export type UtMotionDrawPacket = MotionDrawPacket;
export type UtMotionAssets = MotionAssets;
export type UtMotionWorkerInput = MotionWorkerInput;
export type UtMotionWorkerMessage = MotionWorkerMessage;

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
