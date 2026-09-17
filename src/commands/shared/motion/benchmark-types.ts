import { CommandAttachment } from "../../types";
import {
  MotionAssets,
  MotionDrawPacket,
  MotionPlan,
  MotionProgress,
} from "./types";

export type MotionBenchmarkEngine = "legacy" | "rust";

export interface MotionBenchmarkTimings {
  parsingProjectMs: number;
  measuringMs: number;
  motionEvaluationMs: number;
  layoutMs: number;
  paletteGenerationMs: number;
  canvasDrawMs: number;
  rgbaExtractionMs: number;
  rgbaTransferMs: number;
  packetHashMs: number;
  pixelHashMs: number;
  workerTotalMs: number;
  encodingMs: number;
  totalMs: number;
}

export interface MotionBenchmarkMemory {
  rssBefore: number;
  rssPeak: number;
  rssAfter: number;
  scope: "node";
}

export interface MotionBenchmarkFrame {
  motion: string;
  frame: number;
}

export interface MotionBenchmarkWorkerResult {
  width: number;
  height: number;
  totalFrames: number;
  timings: Omit<MotionBenchmarkTimings, "encodingMs" | "totalMs">;
  packetHashes: readonly string[];
  pixelHashes: readonly string[];
  frames: readonly MotionBenchmarkFrame[];
  mismatchPackets?: readonly MotionDrawPacket[];
}

export interface MotionBenchmarkRun {
  engine: MotionBenchmarkEngine;
  attachment: CommandAttachment;
  outputHash: string;
  outputBytes: number;
  timings: MotionBenchmarkTimings;
  memory: MotionBenchmarkMemory;
  worker: MotionBenchmarkWorkerResult;
}

export interface MotionPacketMismatch {
  frameIndex: number;
  motion: string;
  motionFrame: number;
  packet?: number;
  field: string;
  legacy: unknown;
  rust: unknown;
}

export interface MotionBenchmarkComparison {
  frameHashesMatch: boolean;
  matchingPacketFrames: number;
  matchingPixelFrames: number;
  dimensionsMatch: boolean;
  durationMatch: boolean;
  outputHashMatch: boolean;
  firstMismatch?: MotionPacketMismatch;
}

export interface MotionBenchmarkResult {
  assetLoadingMs: number;
  legacy: MotionBenchmarkRun;
  rust: MotionBenchmarkRun;
  comparison: MotionBenchmarkComparison;
}

export interface MotionBenchmarkRenderer {
  render(
    plan: MotionPlan,
    fetchAsset: (relativePath: string) => Promise<Uint8Array>,
    onProgress?: (engine: MotionBenchmarkEngine, progress: MotionProgress) => void,
  ): Promise<MotionBenchmarkResult | undefined>;
}

export interface MotionBenchmarkWorkerInput {
  plan: MotionPlan;
  assets: MotionAssets;
  engine: MotionBenchmarkEngine;
  expectedPacketHashes?: readonly string[];
  inspectFrameIndex?: number;
}

export type MotionBenchmarkWorkerMessage =
  | { kind: "ready"; width: number; height: number; palette?: Uint8Array }
  | { kind: "invalid" }
  | { kind: "progress"; progress: MotionProgress }
  | { kind: "result"; data: Uint8Array }
  | { kind: "benchmark"; result: MotionBenchmarkWorkerResult };
