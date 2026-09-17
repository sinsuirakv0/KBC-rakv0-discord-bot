import path from "node:path";
import { existsSync } from "node:fs";
import { Image } from "@napi-rs/canvas";
import { MotionDrawPacket, MotionKind } from "./types";

interface RustCut {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

interface RustImgCut {
  version: number;
  imageName: string;
  cuts: RustCut[];
}

interface RustDrawOptions {
  originX?: number;
  originY?: number;
  scale?: number;
  facing?: number;
  alpha?: number;
  useModelAnchor?: boolean;
  interpolate?: boolean;
}

interface RustProject {
  getMaxFrame(motionKey: string): number;
  getImgcutJson(): string;
  buildDrawPackets(
    motionKey: string,
    frame: number,
    options?: RustDrawOptions,
  ): MotionDrawPacket[];
  buildFrameSet(motionKeys: readonly string[], frames: readonly number[]): {
    data: Uint8Array;
    offsets: readonly number[];
    packetCounts: readonly number[];
  };
}

interface RustProjectConstructor {
  new(
    imgcutText: string,
    modelText: string,
    motions: readonly { key: string; text: string }[],
    imageWidth: number,
    imageHeight: number,
  ): RustProject;
}

export interface RustMotionBinding {
  MotionCoreProject: RustProjectConstructor;
  parseImgCutJson(text: string): string;
  parseMaModelJson(text: string): string;
  parseMaAnimJson(text: string): string;
}

let cachedBinding: RustMotionBinding | undefined;

function bindingCandidates(): readonly string[] {
  const configured = process.env.MOTION_CORE_NATIVE_PATH;
  return [
    configured,
    path.join(__dirname, "kbc_motion_core.node"),
    path.join(process.cwd(), "native", "motion-core", "kbc_motion_core.node"),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function loadRustMotionBinding(): RustMotionBinding {
  if (cachedBinding) return cachedBinding;
  const candidate = bindingCandidates().find(existsSync);
  if (!candidate) {
    throw new Error("Rust motion-core native module is not built");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const binding = require(candidate) as Partial<RustMotionBinding>;
  if (
    typeof binding.MotionCoreProject !== "function" ||
    typeof binding.parseImgCutJson !== "function" ||
    typeof binding.parseMaModelJson !== "function" ||
    typeof binding.parseMaAnimJson !== "function"
  ) {
    throw new Error("Rust motion-core native module has an invalid API");
  }
  cachedBinding = binding as RustMotionBinding;
  return cachedBinding;
}

export function createRustMotionProject(
  image: Image,
  imgcutText: string,
  modelText: string,
  motionTexts: Readonly<Partial<Record<MotionKind, string>>>,
) {
  const binding = loadRustMotionBinding();
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const project = new binding.MotionCoreProject(
    imgcutText,
    modelText,
    Object.entries(motionTexts).map(([key, text]) => ({ key, text })),
    imageWidth,
    imageHeight,
  );
  const imgcut = JSON.parse(project.getImgcutJson()) as RustImgCut;
  return {
    imgcut,
    getMaxFrame(motion: MotionKind): number {
      return project.getMaxFrame(motion);
    },
    buildDrawPackets(
      motion: MotionKind,
      frame: number,
      options?: RustDrawOptions,
    ): readonly MotionDrawPacket[] {
      return project.buildDrawPackets(motion, frame, options);
    },
    buildFrameSet(frames: readonly { motion: MotionKind; frame: number }[]) {
      const compact = project.buildFrameSet(
        frames.map(({ motion }) => motion),
        frames.map(({ frame }) => frame),
      );
      const data = Buffer.from(
        compact.data.buffer,
        compact.data.byteOffset,
        compact.data.byteLength,
      );
      const packetSize = 144;
      return {
        byteLength: data.byteLength,
        read(
          frameIndex: number,
          options: RustDrawOptions = {},
        ): readonly MotionDrawPacket[] {
          const count = compact.packetCounts[frameIndex];
          let offset = compact.offsets[frameIndex];
          if (count === undefined || offset === undefined) {
            throw new Error("Invalid compact motion frame index");
          }
          const originX = options.originX ?? 0;
          const originY = options.originY ?? 0;
          const scale = options.scale ?? 1;
          const alpha = options.alpha ?? 1;
          const packets = new Array<MotionDrawPacket>(count);
          for (let packetIndex = 0; packetIndex < count; packetIndex += 1) {
            const partIndex = data.readInt32LE(offset);
            const blendMode = data.readInt32LE(offset + 4);
            const opacity = Math.max(0, Math.min(1, data.readDoubleLE(offset + 8) * alpha));
            const positions = new Array<number>(8);
            const uvs = new Array<number>(8);
            for (let index = 0; index < 8; index += 1) {
              const value = data.readDoubleLE(offset + 16 + index * 8);
              positions[index] = (index % 2 === 0 ? originX : originY) + value * scale;
              uvs[index] = data.readDoubleLE(offset + 80 + index * 8);
            }
            packets[packetIndex] = { partIndex, blendMode, opacity, positions, uvs };
            offset += packetSize;
          }
          return packets;
        },
      };
    },
  };
}
