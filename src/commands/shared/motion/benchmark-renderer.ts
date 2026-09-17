import { createHash } from "node:crypto";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import ffmpegPath from "ffmpeg-static";
import {
  motionRenderTimeoutMs,
  motionStallTimeoutMs,
} from "../../../config/motion";
import { createMotionWatchdog } from "./timeout";
import {
  MotionBenchmarkEngine,
  MotionBenchmarkRenderer,
  MotionBenchmarkRun,
  MotionBenchmarkWorkerInput,
  MotionBenchmarkWorkerMessage,
  MotionBenchmarkWorkerResult,
} from "./benchmark-types";
import { findPacketDifference } from "./packet-hash";
import {
  encoderArguments,
  loadMotionAssets,
  MotionJobQueue,
  sharedMotionJobQueue,
} from "./renderer";
import { MotionAssets, MotionPlan, MotionProgress } from "./types";

interface BenchmarkRendererOptions {
  timeoutMs?: number;
  stallTimeoutMs?: number;
  memorySampleIntervalMs?: number;
}

function workerPath(): { filename: string; execArgv: string[] } {
  const fromTypeScript = __filename.endsWith(".ts");
  return {
    filename: path.join(__dirname, `benchmark-worker.${fromTypeScript ? "ts" : "js"}`),
    execArgv: fromTypeScript ? ["-r", "ts-node/register"] : [],
  };
}

async function inspectPackets(
  plan: MotionPlan,
  assets: MotionAssets,
  engine: MotionBenchmarkEngine,
  frameIndex: number,
): Promise<MotionBenchmarkWorkerResult> {
  const location = workerPath();
  const worker = new Worker(location.filename, {
    workerData: { plan, assets, engine, inspectFrameIndex: frameIndex } satisfies MotionBenchmarkWorkerInput,
    env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: "1" },
    execArgv: location.execArgv,
  });
  try {
    return await new Promise<MotionBenchmarkWorkerResult>((resolve, reject) => {
      worker.on("message", (message: MotionBenchmarkWorkerMessage) => {
        if (message.kind === "benchmark") resolve(message.result);
      });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        if (code !== 0) reject(new Error(`Motion inspection worker exited with code ${code}`));
      });
    });
  } finally {
    await worker.terminate();
  }
}

async function renderEngine(
  plan: MotionPlan,
  assets: MotionAssets,
  engine: MotionBenchmarkEngine,
  expectedPacketHashes: readonly string[] | undefined,
  notify: (progress: MotionProgress) => void,
  options: Required<BenchmarkRendererOptions>,
): Promise<MotionBenchmarkRun | undefined> {
  const directory = plan.format === "png"
    ? undefined : await mkdtemp(path.join(tmpdir(), "kbc-motion-benchmark-"));
  const output = directory ? path.join(directory, `motion.${plan.format}`) : undefined;
  const paletteFile = directory ? path.join(directory, "palette.png") : "";
  const location = workerPath();
  const totalStarted = performance.now();
  const rssBefore = process.memoryUsage().rss;
  let rssPeak = rssBefore;
  const memoryTimer = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }, options.memorySampleIntervalMs);
  let worker: Worker | undefined;
  let encoder: ChildProcessWithoutNullStreams | undefined;
  let encoded: Promise<void> | undefined;
  let running: Promise<MotionBenchmarkRun | undefined> | undefined;
  let cancelled = false;
  const watchdog = createMotionWatchdog(options.timeoutMs, options.stallTimeoutMs);
  try {
    worker = new Worker(location.filename, {
      workerData: { plan, assets, engine, expectedPacketHashes } satisfies MotionBenchmarkWorkerInput,
      stdout: true,
      env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: "1" },
      execArgv: location.execArgv,
    });
    const activeWorker = worker;
    let png: Uint8Array | undefined;
    let workerResult: MotionBenchmarkWorkerResult | undefined;
    let resolveReady!: (message: MotionBenchmarkWorkerMessage) => void;
    const ready = new Promise<MotionBenchmarkWorkerMessage>((resolve) => { resolveReady = resolve; });
    activeWorker.on("message", (message: MotionBenchmarkWorkerMessage) => {
      watchdog.touch();
      if (message.kind === "progress") notify(message.progress);
      if (message.kind === "result") png = message.data;
      if (message.kind === "benchmark") workerResult = message.result;
      if (message.kind === "ready" || message.kind === "invalid") resolveReady(message);
    });
    const finished = new Promise<void>((resolve, reject) => {
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code) => code === 0
        ? resolve() : reject(new Error(`Motion benchmark worker exited with code ${code}`)));
    });
    running = (async () => {
      const initial = await Promise.race([
        ready,
        finished.then(() => { throw new Error("Motion benchmark worker exited before initialization"); }),
      ]);
      if (cancelled) throw new Error("Motion benchmark was cancelled");
      if (initial.kind === "invalid") return undefined;
      if (initial.kind !== "ready") throw new Error("Invalid motion benchmark worker response");

      let encodingMs = 0;
      if (plan.format === "png") {
        activeWorker.postMessage("start");
        await finished;
        if (!png) throw new Error("Motion benchmark worker did not return a PNG");
      } else {
        if (!ffmpegPath || !output) throw new Error("ffmpeg is unavailable");
        if (plan.format === "gif") {
          if (!initial.palette) throw new Error("GIF palette sample is unavailable");
          await writeFile(paletteFile, initial.palette);
        }
        if (cancelled) throw new Error("Motion benchmark was cancelled");
        const encodingStarted = performance.now();
        encoder = spawn(
          ffmpegPath,
          encoderArguments(plan.format, output, initial.width, initial.height, paletteFile),
          { windowsHide: true },
        );
        const activeEncoder = encoder;
        let errorOutput = "";
        activeEncoder.stderr.on("data", (data: Buffer) => {
          errorOutput = (errorOutput + data.toString()).slice(-8_192);
        });
        encoded = new Promise<void>((resolve, reject) => {
          activeEncoder.once("error", reject);
          activeEncoder.once("close", (code) => code === 0
            ? resolve() : reject(new Error(`Motion benchmark encoding failed: ${errorOutput}`)));
        });
        const streamed = pipeline(activeWorker.stdout!, activeEncoder.stdin);
        activeWorker.postMessage("start");
        await Promise.all([finished, streamed, encoded]);
        encodingMs = performance.now() - encodingStarted;
      }
      if (!workerResult) throw new Error("Motion benchmark worker did not return metrics");
      const data = plan.format === "png" ? png! : new Uint8Array(await readFile(output!));
      const totalMs = performance.now() - totalStarted;
      const outputHash = createHash("sha256").update(data).digest("hex");
      const rssAfter = process.memoryUsage().rss;
      rssPeak = Math.max(rssPeak, rssAfter);
      return {
        engine,
        attachment: {
          data,
          filename: `${plan.filenameStem}-${engine}.${plan.format}`,
        },
        outputHash,
        outputBytes: data.byteLength,
        timings: { ...workerResult.timings, encodingMs, totalMs },
        memory: { rssBefore, rssPeak, rssAfter, scope: "node" },
        worker: workerResult,
      };
    })();
    return await Promise.race([running, watchdog.expired]);
  } finally {
    cancelled = true;
    clearInterval(memoryTimer);
    watchdog.dispose();
    if (encoder && encoder.exitCode === null) encoder.kill("SIGKILL");
    if (worker) await worker.terminate();
    await running?.catch(() => undefined);
    await encoded?.catch(() => undefined);
    if (directory && output) {
      try {
        for (const file of [output, paletteFile]) {
          await unlink(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
        await rmdir(directory);
      } catch (error) {
        console.error("Motion benchmark temporary file cleanup failed.", error);
      }
    }
  }
}

export function createMotionBenchmarkRenderer(
  configured: BenchmarkRendererOptions = {},
  queue: MotionJobQueue = sharedMotionJobQueue,
): MotionBenchmarkRenderer {
  const options: Required<BenchmarkRendererOptions> = {
    timeoutMs: configured.timeoutMs ?? motionRenderTimeoutMs,
    stallTimeoutMs: configured.stallTimeoutMs ?? motionStallTimeoutMs,
    memorySampleIntervalMs: configured.memorySampleIntervalMs ?? 25,
  };
  return {
    async render(plan, fetchAsset, onProgress) {
      const notify = (engine: MotionBenchmarkEngine, progress: MotionProgress) => {
        try { onProgress?.(engine, progress); }
        catch (error) { console.error("Motion benchmark progress failed.", error); }
      };
      return queue.run((progress) => notify("legacy", progress), async () => {
        notify("legacy", { stage: "loading" });
        const loadingStarted = performance.now();
        const assets = await loadMotionAssets(plan, fetchAsset);
        const assetLoadingMs = performance.now() - loadingStarted;
        const legacy = await renderEngine(
          plan,
          assets,
          "legacy",
          undefined,
          (progress) => notify("legacy", progress),
          options,
        );
        if (!legacy) return undefined;
        const rust = await renderEngine(
          plan,
          assets,
          "rust",
          legacy.worker.packetHashes,
          (progress) => notify("rust", progress),
          options,
        );
        if (!rust) return undefined;
        const firstMismatchIndex = legacy.worker.packetHashes.findIndex(
          (hash, index) => hash !== rust.worker.packetHashes[index],
        );
        let firstMismatch;
        if (firstMismatchIndex >= 0) {
          const legacyInspection = await inspectPackets(
            plan,
            assets,
            "legacy",
            firstMismatchIndex,
          );
          const legacyPackets = legacyInspection.mismatchPackets ?? [];
          const rustPackets = rust.worker.mismatchPackets ?? [];
          const difference = findPacketDifference(legacyPackets, rustPackets);
          const frame = legacy.worker.frames[firstMismatchIndex];
          firstMismatch = {
            frameIndex: firstMismatchIndex,
            motion: frame.motion,
            motionFrame: frame.frame,
            packet: difference?.packet,
            field: difference?.field ?? "packetHash",
            legacy: difference?.legacy ?? legacy.worker.packetHashes[firstMismatchIndex],
            rust: difference?.rust ?? rust.worker.packetHashes[firstMismatchIndex],
          };
        }
        const matchingPacketFrames = legacy.worker.packetHashes.filter(
          (hash, index) => hash === rust.worker.packetHashes[index],
        ).length;
        const matchingPixelFrames = legacy.worker.pixelHashes.filter(
          (hash, index) => hash === rust.worker.pixelHashes[index],
        ).length;
        return {
          assetLoadingMs,
          legacy,
          rust,
          comparison: {
            frameHashesMatch: matchingPacketFrames === legacy.worker.totalFrames
              && legacy.worker.totalFrames === rust.worker.totalFrames,
            matchingPacketFrames,
            matchingPixelFrames,
            dimensionsMatch: legacy.worker.width === rust.worker.width
              && legacy.worker.height === rust.worker.height,
            durationMatch: legacy.worker.totalFrames === rust.worker.totalFrames,
            outputHashMatch: legacy.outputHash === rust.outputHash,
            firstMismatch,
          },
        };
      });
    },
  };
}

export const motionBenchmarkRenderer = createMotionBenchmarkRenderer();
