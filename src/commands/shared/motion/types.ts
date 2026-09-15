import { CommandAttachment } from "../../types";

export type MotionFormat = "png" | "mp4" | "gif";
export type MotionKind = "attack" | "move" | "idle" | "knockback";

export interface MotionSegment {
  motion: MotionKind;
  range?: { start: number; end: number };
  frame?: number;
}

export interface MotionRequest {
  format: MotionFormat;
  full: boolean;
  segments: readonly MotionSegment[];
}

export interface MotionPlan extends MotionRequest {
  filenameStem: string;
  previewScale: number;
  spritePath: string;
  imgcutPath: string;
  modelPath: string;
  animationPaths: Readonly<Partial<Record<MotionKind, string>>>;
}

export interface MotionRenderer {
  render(
    plan: MotionPlan,
    fetchAsset: (relativePath: string) => Promise<Uint8Array>,
    onProgress?: (progress: MotionProgress) => void,
  ): Promise<CommandAttachment | undefined>;
}

export type MotionProgress =
  | { stage: "queued" | "loading" | "encoding" | "sending" }
  | { stage: "measuring" | "rendering"; completedFrames: number; totalFrames: number };

export interface MotionDrawPacket {
  partIndex: number;
  positions: readonly number[];
  uvs: readonly number[];
  opacity: number;
  blendMode: number;
}

export interface MotionAssets {
  sprite: Uint8Array;
  imgcut: Uint8Array;
  model: Uint8Array;
  animations: Readonly<Partial<Record<MotionKind, Uint8Array>>>;
}

export interface MotionWorkerInput {
  plan: MotionPlan;
  assets: MotionAssets;
}

export type MotionWorkerMessage =
  | { kind: "ready"; width: number; height: number; palette?: Uint8Array }
  | { kind: "invalid" }
  | { kind: "progress"; progress: MotionProgress }
  | { kind: "result"; data: Uint8Array };
