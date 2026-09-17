import { motionFrameRate } from "../../config/motion";
import {
  MotionBenchmarkResult,
  MotionBenchmarkRun,
} from "../shared/motion/benchmark-types";

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(2)}s`;
}

function mebibytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function ratio(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator).toFixed(2)}x` : "N/A";
}

function formatRun(label: string, run: MotionBenchmarkRun): string {
  const timing = run.timings;
  return [
    label,
    `Parsing / project: ${seconds(timing.parsingProjectMs)}`,
    `Measuring wall time: ${seconds(timing.measuringMs)}`,
    `Motion evaluation: ${seconds(timing.motionEvaluationMs)}`,
    `Layout: ${seconds(timing.layoutMs)}`,
    `Palette generation: ${seconds(timing.paletteGenerationMs)}`,
    `Canvas draw: ${seconds(timing.canvasDrawMs)}`,
    `RGBA extraction: ${seconds(timing.rgbaExtractionMs)}`,
    `RGBA transfer: ${seconds(timing.rgbaTransferMs)}`,
    `FFmpeg encoding: ${seconds(timing.encodingMs)}`,
    `Comparison hashing: ${seconds(timing.packetHashMs + timing.pixelHashMs)}`,
    `Total: ${seconds(timing.totalMs)}`,
    `Output: ${mebibytes(run.outputBytes)}`,
    `Node RSS peak: ${mebibytes(run.memory.rssPeak)}`,
  ].join("\n");
}

export function formatMotionBenchmarkResult(
  character: string,
  result: MotionBenchmarkResult,
): string {
  const { legacy, rust, comparison } = result;
  const packetTotal = legacy.worker.totalFrames;
  const pixelTotal = legacy.worker.pixelHashes.length;
  const mismatch = comparison.firstMismatch;
  const mismatchText = mismatch
    ? [
        "",
        "First packet mismatch:",
        `Output frame: ${mismatch.frameIndex}`,
        `Motion frame: ${mismatch.motion} ${mismatch.motionFrame}`,
        `Packet: ${mismatch.packet ?? "N/A"}`,
        `Field: ${mismatch.field}`,
        `Legacy: ${String(mismatch.legacy)}`,
        `Rust: ${String(mismatch.rust)}`,
      ]
    : [];
  return [
    "motion benchmark",
    "",
    `Character: ${character}`,
    `Format: ${legacy.attachment.filename.split(".").at(-1)?.toUpperCase()}`,
    `Frames: ${legacy.worker.totalFrames}`,
    `Resolution: ${legacy.worker.width}x${legacy.worker.height}`,
    `FPS: ${motionFrameRate}`,
    `Shared asset loading: ${seconds(result.assetLoadingMs)}`,
    "",
    formatRun("Legacy", legacy),
    "",
    formatRun("Rust", rust),
    "",
    `Total speedup: ${ratio(legacy.timings.totalMs, rust.timings.totalMs)}`,
    `Motion-core speedup: ${ratio(legacy.timings.motionEvaluationMs, rust.timings.motionEvaluationMs)}`,
    "",
    "Comparison:",
    `Frames: ${legacy.worker.totalFrames === rust.worker.totalFrames ? "MATCH" : "DIFFERENT"}`,
    `Dimensions: ${comparison.dimensionsMatch ? "MATCH" : "DIFFERENT"}`,
    `Duration: ${comparison.durationMatch ? "MATCH" : "DIFFERENT"}`,
    `Motion packets: ${comparison.matchingPacketFrames} / ${packetTotal} MATCH`,
    `Frame pixels: ${comparison.matchingPixelFrames} / ${pixelTotal} MATCH`,
    `Output hash: ${comparison.outputHashMatch ? "MATCH" : "DIFFERENT"}`,
    ...mismatchText,
  ].join("\n");
}
