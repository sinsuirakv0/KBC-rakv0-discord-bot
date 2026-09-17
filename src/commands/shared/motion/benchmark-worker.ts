import { createHash } from "node:crypto";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { parentPort, workerData } from "node:worker_threads";
import { loadImage } from "@napi-rs/canvas";
import { motionPngPixelRatio, motionVideoMaxPixels } from "../../../config/motion";
import { createMotionCanvas, createVisibleCutBounds } from "./canvas";
import { createMotionLayout } from "./layout";
import { createMotionPaletteSample } from "./palette";
import { hashMotionPackets } from "./packet-hash";
import { createRustMotionProject } from "./rust-core";
import {
  MotionBenchmarkFrame,
  MotionBenchmarkWorkerInput,
  MotionBenchmarkWorkerMessage,
  MotionBenchmarkWorkerResult,
} from "./benchmark-types";
import { MotionDrawPacket, MotionKind } from "./types";
import {
  buildNativeDrawPackets,
  createMotionProject,
  parseImgCut,
  parseMaAnim,
  parseMaModel,
} from "./vendor/motion-engine";

interface PacketOptions {
  originX?: number;
  originY?: number;
  scale?: number;
}

interface PacketEngine {
  cuts: readonly { x: number; y: number; width: number; height: number }[];
  getMaxFrame(motion: MotionKind): number;
  build(
    motion: MotionKind,
    frame: number,
    options?: PacketOptions,
  ): readonly MotionDrawPacket[];
  buildFrameSet?(frames: readonly MotionBenchmarkFrame[]): {
    byteLength: number;
    read(index: number, options?: PacketOptions): readonly MotionDrawPacket[];
  };
}

interface BenchmarkSegment {
  motion: MotionKind;
  start: number;
  end: number;
}

function createLegacyEngine(
  image: Awaited<ReturnType<typeof loadImage>>,
  imgcutText: string,
  modelText: string,
  motionTexts: Readonly<Partial<Record<MotionKind, string>>>,
): PacketEngine {
  const motions = Object.fromEntries(Object.entries(motionTexts).map(
    ([motion, text]) => [motion, parseMaAnim(text)],
  ));
  const project = createMotionProject({
    image,
    imgcut: parseImgCut(imgcutText),
    model: parseMaModel(modelText),
    motions,
  });
  return {
    cuts: project.imgcut.cuts,
    getMaxFrame: (motion) => motions[motion].maxFrame,
    build: (motion, frame, options) =>
      buildNativeDrawPackets(project, motion, frame, options).packets,
  };
}

function framesFromSegments(segments: readonly BenchmarkSegment[]): MotionBenchmarkFrame[] {
  return segments.flatMap(({ motion, start, end }) =>
    Array.from({ length: end - start + 1 }, (_, offset) => ({
      motion,
      frame: start + offset,
    })),
  );
}

function elapsed(start: number): number {
  return performance.now() - start;
}

async function render(): Promise<void> {
  if (!parentPort) throw new Error("Motion benchmark requires a worker thread");
  const port = parentPort;
  const send = (message: MotionBenchmarkWorkerMessage) => port.postMessage(message);
  const input = workerData as MotionBenchmarkWorkerInput;
  const { plan, assets } = input;
  const workerStarted = performance.now();
  const decode = (data: Uint8Array) => Buffer.from(data).toString("utf8");
  const parsingStarted = performance.now();
  const image = await loadImage(Buffer.from(assets.sprite));
  const imgcutText = decode(assets.imgcut);
  const modelText = decode(assets.model);
  const motionTexts = Object.fromEntries(Object.entries(assets.animations).map(
    ([motion, data]) => [motion, decode(data)],
  ));
  const engine: PacketEngine = input.engine === "legacy"
    ? createLegacyEngine(image, imgcutText, modelText, motionTexts)
    : (() => {
        const rust = createRustMotionProject(image, imgcutText, modelText, motionTexts);
        return {
          cuts: rust.imgcut.cuts,
          getMaxFrame: rust.getMaxFrame,
          build: rust.buildDrawPackets,
          buildFrameSet: rust.buildFrameSet,
        };
      })();
  const parsingProjectMs = elapsed(parsingStarted);
  let motionEvaluationMs = 0;
  let layoutMs = 0;
  let canvasDrawMs = 0;
  let rgbaExtractionMs = 0;
  let rgbaTransferMs = 0;
  let packetHashMs = 0;
  let pixelHashMs = 0;
  const build = (motion: MotionKind, frame: number, options?: PacketOptions) => {
    const started = performance.now();
    const packets = engine.build(motion, frame, options);
    motionEvaluationMs += elapsed(started);
    return packets;
  };
  const segments: BenchmarkSegment[] = plan.segments.map((segment) => ({
    motion: segment.motion,
    start: plan.format === "png" ? segment.frame ?? 0 : segment.range?.start ?? 0,
    end: plan.format === "png"
      ? segment.frame ?? 0
      : segment.range?.end ?? engine.getMaxFrame(segment.motion),
  }));
  if (segments.some(({ motion, start, end }) =>
    start < 0 || end < start || end > engine.getMaxFrame(motion),
  )) {
    send({ kind: "invalid" });
    port.close();
    return;
  }
  const frames = framesFromSegments(segments);
  const totalFrames = frames.length;
  const referencePackets = [...new Set(segments.map((segment) => segment.motion))]
    .flatMap((motion) => build(motion, 0));
  const layoutStarted = performance.now();
  const layout = createMotionLayout(
    createVisibleCutBounds(image, engine.cuts),
    referencePackets,
  );
  layoutMs += elapsed(layoutStarted);
  let lastProgressTime = 0;
  const report = (stage: "measuring" | "rendering", completedFrames: number) => {
    const now = Date.now();
    if (completedFrames !== 0 && completedFrames !== totalFrames && now - lastProgressTime < 1_000) return;
    lastProgressTime = now;
    send({ kind: "progress", progress: { stage, completedFrames, totalFrames } });
  };
  const measuringStarted = performance.now();
  const compactStarted = performance.now();
  const compactFrames = engine.buildFrameSet?.(frames);
  if (compactFrames) motionEvaluationMs += elapsed(compactStarted);
  const buildOutputFrame = (
    index: number,
    options?: PacketOptions,
  ): readonly MotionDrawPacket[] => {
    if (compactFrames) return compactFrames.read(index, options);
    const frame = frames[index];
    return build(frame.motion as MotionKind, frame.frame, options);
  };
  report("measuring", 0);
  for (let index = 0; index < frames.length; index += 1) {
    const packets = buildOutputFrame(index);
    const addStarted = performance.now();
    layout.add(packets);
    layoutMs += elapsed(addStarted);
    report("measuring", index + 1);
  }
  const finishStarted = performance.now();
  const view = layout.finish(plan.previewScale * 0.5, {
    maxPixels: plan.format === "png" ? undefined : motionVideoMaxPixels,
    pixelRatio: plan.format === "png" ? motionPngPixelRatio : 1,
    full: plan.full,
  });
  layoutMs += elapsed(finishStarted);
  const measuringMs = elapsed(measuringStarted);

  if (input.inspectFrameIndex !== undefined) {
    const target = frames[input.inspectFrameIndex];
    if (!target) throw new Error("Invalid benchmark inspection frame");
    const packets = buildOutputFrame(input.inspectFrameIndex, view);
    const result: MotionBenchmarkWorkerResult = {
      width: view.width,
      height: view.height,
      totalFrames,
      timings: {
        parsingProjectMs,
        measuringMs,
        motionEvaluationMs,
        layoutMs,
        paletteGenerationMs: 0,
        canvasDrawMs,
        rgbaExtractionMs,
        rgbaTransferMs,
        packetHashMs,
        pixelHashMs,
        workerTotalMs: elapsed(workerStarted),
      },
      packetHashes: [],
      pixelHashes: [],
      frames,
      mismatchPackets: packets,
    };
    send({ kind: "benchmark", result });
    port.close();
    return;
  }

  const { canvas, draw } = createMotionCanvas(image, view.width, view.height);
  const paletteStarted = performance.now();
  const evaluationBeforePalette = motionEvaluationMs;
  const palette = plan.format === "gif"
    ? await createMotionPaletteSample(image, totalFrames, (index, scale) => {
        const frame = frames[index];
        return buildOutputFrame(index, {
          scale: view.scale * scale,
          originX: view.originX * scale,
          originY: view.originY * scale,
        });
      }, view.width, view.height)
    : undefined;
  const paletteGenerationMs = plan.format === "gif"
    ? elapsed(paletteStarted) - (motionEvaluationMs - evaluationBeforePalette)
    : 0;
  const startSignal = once(port, "message");
  send({ kind: "ready", width: view.width, height: view.height, palette });
  await startSignal;
  report("rendering", 0);

  const packetHashes: string[] = [];
  const pixelHashes: string[] = [];
  let mismatchPackets: readonly MotionDrawPacket[] | undefined;
  let previousPackets: readonly MotionDrawPacket[] | undefined;
  let previousPixels: Buffer | undefined;
  let previousPixelHash: string | undefined;
  for (let index = 0; index < frames.length; index += 1) {
    const packets = buildOutputFrame(index, view);
    const packetHashStarted = performance.now();
    const packetHash = hashMotionPackets(packets);
    packetHashMs += elapsed(packetHashStarted);
    packetHashes.push(packetHash);
    if (
      !mismatchPackets &&
      input.expectedPacketHashes &&
      input.expectedPacketHashes[index] !== packetHash
    ) {
      mismatchPackets = packets;
    }
    const unchanged = previousPackets?.length === packets.length && packets.every((packet, packetIndex) => {
      const previous = previousPackets![packetIndex];
      return packet.opacity === previous.opacity && packet.blendMode === previous.blendMode
        && packet.positions.every((value, offset) => value === previous.positions[offset])
        && packet.uvs.every((value, offset) => value === previous.uvs[offset]);
    });
    if (!unchanged) {
      const drawStarted = performance.now();
      draw(packets);
      canvasDrawMs += elapsed(drawStarted);
    }
    const extractionStarted = performance.now();
    if (!unchanged || !previousPixels) previousPixels = canvas.data();
    rgbaExtractionMs += elapsed(extractionStarted);
    if (!unchanged || !previousPixelHash) {
      const pixelHashStarted = performance.now();
      previousPixelHash = createHash("sha256").update(previousPixels).digest("hex");
      pixelHashMs += elapsed(pixelHashStarted);
    }
    pixelHashes.push(previousPixelHash);
    if (plan.format === "png") {
      send({ kind: "result", data: await canvas.encode("png") });
    } else {
      const transferStarted = performance.now();
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(previousPixels!, (error) => error ? reject(error) : resolve());
      });
      rgbaTransferMs += elapsed(transferStarted);
    }
    previousPackets = packets;
    report("rendering", index + 1);
  }
  const result: MotionBenchmarkWorkerResult = {
    width: view.width,
    height: view.height,
    totalFrames,
    timings: {
      parsingProjectMs,
      measuringMs,
      motionEvaluationMs,
      layoutMs,
      paletteGenerationMs,
      canvasDrawMs,
      rgbaExtractionMs,
      rgbaTransferMs,
      packetHashMs,
      pixelHashMs,
      workerTotalMs: elapsed(workerStarted),
    },
    packetHashes,
    pixelHashes,
    frames,
    mismatchPackets,
  };
  send({ kind: "benchmark", result });
  port.close();
}

void render();
