import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import ffmpegPath from "ffmpeg-static";
import {
  motionFrameRate,
  motionRenderTimeoutMs,
  motionStallTimeoutMs,
} from "../../../config/motion";
import { CommandAttachment } from "../../types";
import { createMotionWatchdog } from "./timeout";
import {
  MotionPlan,
  MotionAssets,
  MotionProgress,
  MotionRenderer,
  MotionWorkerMessage,
} from "./types";

export async function loadMotionAssets(
  plan: MotionPlan,
  fetchAsset: (relativePath: string) => Promise<Uint8Array>,
): Promise<MotionAssets> {
  const [sprite, imgcut, model, animations] = await Promise.all([
    fetchAsset(plan.spritePath),
    fetchAsset(plan.imgcutPath),
    fetchAsset(plan.modelPath),
    Promise.all(Object.entries(plan.animationPaths).map(async ([motion, assetPath]) =>
      [motion, await fetchAsset(assetPath)] as const,
    )),
  ]);
  return { sprite, imgcut, model, animations: Object.fromEntries(animations) };
}

export interface MotionJobQueue {
  run<T>(
    notify: (progress: MotionProgress) => void,
    job: () => Promise<T>,
  ): Promise<T>;
}

export function createMotionJobQueue(): MotionJobQueue {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    async run<T>(notify: (progress: MotionProgress) => void, job: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      if (pending > 0) notify({ stage: "queued" });
      pending += 1;
      await previous;
      try {
        return await job();
      } finally {
        pending -= 1;
        release();
      }
    },
  };
}

export const sharedMotionJobQueue = createMotionJobQueue();

export function encoderArguments(format: "mp4" | "gif", output: string, width: number, height: number, palette: string): string[] {
  const input = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-video_size", `${width}x${height}`,
    "-framerate", String(motionFrameRate), "-i", "pipe:0",
  ];
  return format === "mp4"
    ? [...input,
        "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output,
      ]
    : [...input,
        "-threads", "1", "-i", palette,
        "-filter_complex",
        "[1:v]palettegen=reserve_transparent=0[p];[0:v][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
        "-threads", "1", "-loop", "0", output,
      ];
}

async function renderInWorker(
  plan: MotionPlan,
  assets: MotionAssets,
  notify: (progress: MotionProgress) => void,
  timeoutMs: number,
  stallTimeoutMs: number,
): Promise<CommandAttachment | undefined> {
  const directory = plan.format === "png"
    ? undefined : await mkdtemp(path.join(tmpdir(), "kbc-motion-"));
  const output = directory ? path.join(directory, `motion.${plan.format}`) : undefined;
  const paletteFile = directory ? path.join(directory, "palette.png") : "";
  let worker: Worker | undefined;
  let encoder: ChildProcessWithoutNullStreams | undefined;
  let encoded: Promise<void> | undefined;
  let running: Promise<CommandAttachment | undefined> | undefined;
  let cancelled = false;
  const watchdog = createMotionWatchdog(timeoutMs, stallTimeoutMs);
  try {
    const fromTypeScript = __filename.endsWith(".ts");
    worker = new Worker(path.join(__dirname, `worker.${fromTypeScript ? "ts" : "js"}`), {
      workerData: { plan, assets },
      stdout: true,
      env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: "1" },
      execArgv: fromTypeScript ? ["-r", "ts-node/register"] : [],
    });
    const activeWorker = worker;
    let png: Uint8Array | undefined;
    let resolveReady!: (message: MotionWorkerMessage) => void;
    const ready = new Promise<MotionWorkerMessage>((resolve) => { resolveReady = resolve; });
    activeWorker.on("message", (message: MotionWorkerMessage) => {
      watchdog.touch();
      if (message.kind === "progress") notify(message.progress);
      if (message.kind === "result") png = message.data;
      if (message.kind === "ready" || message.kind === "invalid") resolveReady(message);
    });
    const finished = new Promise<void>((resolve, reject) => {
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code) => code === 0
        ? resolve() : reject(new Error(`Motion worker exited with code ${code}`)));
    });

    const run = async (): Promise<CommandAttachment | undefined> => {
      const initial = await Promise.race([
        ready,
        finished.then(() => { throw new Error("Motion worker exited before initialization"); }),
      ]);
      if (cancelled) throw new Error("Motion rendering was cancelled");
      if (initial.kind === "invalid") return undefined;
      if (initial.kind !== "ready") throw new Error("Invalid motion worker response");

      if (plan.format === "png") {
        activeWorker.postMessage("start");
        await finished;
        if (!png) throw new Error("Motion worker did not return a PNG");
        return { data: png, filename: `${plan.filenameStem}.png` };
      }
      if (!ffmpegPath || !output) throw new Error("ffmpeg is unavailable");
      if (plan.format === "gif") {
        if (!initial.palette) throw new Error("GIF palette sample is unavailable");
        await writeFile(paletteFile, initial.palette);
      }
      if (cancelled) throw new Error("Motion rendering was cancelled");
      encoder = spawn(ffmpegPath, encoderArguments(plan.format, output, initial.width, initial.height, paletteFile), { windowsHide: true });
      const activeEncoder = encoder;
      let errorOutput = "";
      activeEncoder.stderr.on("data", (data: Buffer) => {
        errorOutput = (errorOutput + data.toString()).slice(-8_192);
      });
      encoded = new Promise<void>((resolve, reject) => {
        activeEncoder.once("error", reject);
        activeEncoder.once("close", (code) => code === 0
          ? resolve() : reject(new Error(`Motion encoding failed: ${errorOutput}`)));
      });
      // pipeの逆圧でワーカーも待つため、全フレームをメモリへ溜めない。
      const streamed = pipeline(activeWorker.stdout!, activeEncoder.stdin);
      activeWorker.postMessage("start");
      await Promise.all([
        finished.then(() => notify({ stage: "encoding" })),
        streamed,
        encoded,
      ]);
      return {
        data: new Uint8Array(await readFile(output)),
        filename: `${plan.filenameStem}.${plan.format}`,
      };
    };
    running = run();
    return await Promise.race([running, watchdog.expired]);
  } finally {
    cancelled = true;
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
        console.error("Motion temporary file cleanup failed.", error);
      }
    }
  }
}

export function createMotionRenderer(
  options: { timeoutMs?: number; stallTimeoutMs?: number } = {},
  queue: MotionJobQueue = createMotionJobQueue(),
): MotionRenderer {
  return {
    async render(plan, fetchAsset, onProgress) {
      const notify = (progress: MotionProgress) => {
        try { onProgress?.(progress); }
        catch (error) { console.error("Motion progress failed.", error); }
      };
      return queue.run(notify, async () => {
        notify({ stage: "loading" });
        const assets = await loadMotionAssets(plan, fetchAsset);
        return await renderInWorker(plan, assets, notify,
          options.timeoutMs ?? motionRenderTimeoutMs, options.stallTimeoutMs ?? motionStallTimeoutMs);
      });
    },
  };
}

export const motionRenderer = createMotionRenderer({}, sharedMotionJobQueue);
