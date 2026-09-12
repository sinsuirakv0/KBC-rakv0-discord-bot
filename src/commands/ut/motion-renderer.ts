import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import ffmpegPath from "ffmpeg-static";
import {
  utMotionFrameRate,
  utMotionHeight,
  utMotionRenderTimeoutMs,
  utMotionWidth,
} from "../../config/ut";
import { CommandAttachment } from "../types";
import {
  UtMotionAssetPlan,
  UtMotionAssets,
  UtMotionProgress,
  UtMotionRenderer,
  UtMotionWorkerMessage,
} from "./types";

async function loadMotionAssets(
  plan: UtMotionAssetPlan,
  fetchAsset: (relativePath: string) => Promise<Uint8Array>,
): Promise<UtMotionAssets> {
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

function encoderArguments(format: "mp4" | "gif", output: string): string[] {
  const input = [
    "-y", "-hide_banner", "-loglevel", "error",
    "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1",
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-video_size", `${utMotionWidth}x${utMotionHeight}`,
    "-framerate", String(utMotionFrameRate), "-i", "pipe:0",
  ];
  return format === "mp4"
    ? [...input,
        "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", output,
      ]
    : [...input,
        "-filter_complex",
        "split[a][b];[a]palettegen=stats_mode=single:reserve_transparent=0[p];[b][p]paletteuse=new=1:dither=bayer:bayer_scale=3",
        "-threads", "1", "-loop", "0", output,
      ];
}

async function renderInWorker(
  plan: UtMotionAssetPlan,
  assets: UtMotionAssets,
  notify: (progress: UtMotionProgress) => void,
  timeoutMs: number,
): Promise<CommandAttachment | undefined> {
  const directory = plan.format === "png"
    ? undefined : await mkdtemp(path.join(tmpdir(), "kbc-ut-motion-"));
  const output = directory ? path.join(directory, `motion.${plan.format}`) : undefined;
  let worker: Worker | undefined;
  let encoder: ChildProcessWithoutNullStreams | undefined;
  let encoded: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const fromTypeScript = __filename.endsWith(".ts");
    worker = new Worker(path.join(__dirname, `motion-worker.${fromTypeScript ? "ts" : "js"}`), {
      workerData: { plan, assets },
      stdout: true,
      env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: "1" },
      execArgv: fromTypeScript ? ["-r", "ts-node/register"] : [],
    });
    const activeWorker = worker;
    let png: Uint8Array | undefined;
    activeWorker.on("message", (message: UtMotionWorkerMessage) => {
      if (message.kind === "progress") notify(message.progress);
      if (message.kind === "result") png = message.data;
    });
    const ready = new Promise<UtMotionWorkerMessage>((resolve) => activeWorker.once("message", resolve));
    const finished = new Promise<void>((resolve, reject) => {
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code) => code === 0
        ? resolve() : reject(new Error(`Motion worker exited with code ${code}`)));
    });
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Motion rendering timed out")), timeoutMs);
    });

    const run = async (): Promise<CommandAttachment | undefined> => {
      const initial = await Promise.race([
        ready,
        finished.then(() => { throw new Error("Motion worker exited before initialization"); }),
      ]);
      if (initial.kind === "invalid") return undefined;
      if (initial.kind !== "ready") throw new Error("Invalid motion worker response");

      if (plan.format === "png") {
        activeWorker.postMessage("start");
        await finished;
        if (!png) throw new Error("Motion worker did not return a PNG");
        return { data: png, filename: `ut-${plan.id}-${plan.form}-motion.png` };
      }
      if (!ffmpegPath || !output) throw new Error("ffmpeg is unavailable");
      encoder = spawn(ffmpegPath, encoderArguments(plan.format, output), { windowsHide: true });
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
        filename: `ut-${plan.id}-${plan.form}-motion.${plan.format}`,
      };
    };
    return await Promise.race([run(), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (encoder && encoder.exitCode === null) encoder.kill("SIGKILL");
    if (worker) await worker.terminate();
    await encoded?.catch(() => undefined);
    if (directory && output) {
      try {
        await unlink(output).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        await rmdir(directory);
      } catch (error) {
        console.error("Ut motion temporary file cleanup failed.", error);
      }
    }
  }
}

export function createUtMotionRenderer(
  options: { timeoutMs?: number } = {},
): UtMotionRenderer {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    async render(plan, fetchAsset, onProgress) {
      const notify = (progress: UtMotionProgress) => {
        try { onProgress?.(progress); }
        catch (error) { console.error("Ut motion progress failed.", error); }
      };
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      if (pending > 0) notify({ stage: "queued" });
      pending += 1;
      await previous;
      try {
        notify({ stage: "loading" });
        const assets = await loadMotionAssets(plan, fetchAsset);
        return await renderInWorker(plan, assets, notify, options.timeoutMs ?? utMotionRenderTimeoutMs);
      } finally {
        pending -= 1;
        release();
      }
    },
  };
}

export const utMotionRenderer = createUtMotionRenderer();
