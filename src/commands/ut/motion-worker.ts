import { once } from "node:events";
import { parentPort, workerData } from "node:worker_threads";
import { loadImage } from "@napi-rs/canvas";
import { utMotionHeight, utMotionWidth } from "../../config/ut";
import { createMotionCanvas } from "./motion-canvas";
import { UtMotionWorkerInput, UtMotionWorkerMessage } from "./types";
import {
  buildNativeDrawPackets,
  createMotionProject,
  parseImgCut,
  parseMaAnim,
  parseMaModel,
} from "./vendor/motion-engine";

async function render(): Promise<void> {
  if (!parentPort) throw new Error("Motion renderer requires a worker thread");
  const port = parentPort;
  const send = (message: UtMotionWorkerMessage) => port.postMessage(message);
  const { plan, assets } = workerData as UtMotionWorkerInput;
  const decode = (data: Uint8Array) => Buffer.from(data).toString("utf8");
  const image = await loadImage(Buffer.from(assets.sprite));
  const motions = Object.fromEntries(Object.entries(assets.animations).map(
    ([motion, data]) => [motion, parseMaAnim(decode(data))],
  ));
  const project = createMotionProject({
    image,
    imgcut: parseImgCut(decode(assets.imgcut)),
    model: parseMaModel(decode(assets.model)),
    motions,
  });
  const segments = plan.segments.map((segment) => ({
    motion: segment.motion,
    start: plan.format === "png" ? segment.frame ?? 0 : segment.range?.start ?? 0,
    end: plan.format === "png"
      ? segment.frame ?? 0
      : segment.range?.end ?? motions[segment.motion].maxFrame,
  }));
  if (segments.some(({ motion, start, end }) =>
    start < 0 || end < start || end > motions[motion].maxFrame,
  )) {
    send({ kind: "invalid" });
    port.close();
    return;
  }
  const totalFrames = segments.reduce((total, segment) => total + segment.end - segment.start + 1, 0);
  const { canvas, draw } = createMotionCanvas(image);
  const previewScale = plan.id === "000" && plan.form === "f" ? 2.25
    : plan.id === "009" && plan.form === "f" ? 0.82 : 1;
  const view = { originX: utMotionWidth * 0.5, originY: utMotionHeight * 0.78, scale: previewScale * 0.5 };
  const startSignal = once(port, "message");
  send({ kind: "ready" });
  await startSignal;
  send({ kind: "progress", progress: { stage: "rendering", completedFrames: 0, totalFrames } });

  let completedFrames = 0;
  let lastPercent = -1;
  for (const segment of segments) {
    for (let frame = segment.start; frame <= segment.end; frame += 1) {
      draw(buildNativeDrawPackets(project, segment.motion, frame, view).packets);
      if (plan.format === "png") {
        send({ kind: "result", data: await canvas.encode("png") });
      } else {
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(canvas.data(), (error) => error ? reject(error) : resolve());
        });
      }
      completedFrames += 1;
      const percent = Math.floor(completedFrames * 100 / totalFrames);
      if (percent !== lastPercent) {
        send({ kind: "progress", progress: { stage: "rendering", completedFrames, totalFrames } });
        lastPercent = percent;
      }
    }
  }
  port.close();
}

void render();
