import { once } from "node:events";
import { parentPort, workerData } from "node:worker_threads";
import { loadImage } from "@napi-rs/canvas";
import { utMotionPngPixelRatio, utMotionVideoMaxPixels } from "../../config/ut";
import { createMotionCanvas, createVisibleCutBounds } from "./motion-canvas";
import { createMotionLayout } from "./motion-layout";
import { createMotionPaletteSample } from "./motion-palette";
import { UtMotionDrawPacket, UtMotionWorkerInput, UtMotionWorkerMessage } from "./types";
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
  const referencePackets = [...new Set(segments.map(segment => segment.motion))]
    .flatMap(motion => buildNativeDrawPackets(project, motion, 0).packets);
  const layout = createMotionLayout(createVisibleCutBounds(image, project.imgcut.cuts), referencePackets);
  let measuredFrames = 0;
  let lastProgressTime = 0;
  const report = (stage: "measuring" | "rendering", completedFrames: number) => {
    const now = Date.now();
    if (completedFrames !== 0 && completedFrames !== totalFrames && now - lastProgressTime < 1_000) return;
    lastProgressTime = now;
    send({ kind: "progress", progress: { stage, completedFrames, totalFrames } });
  };
  report("measuring", 0);
  for (const segment of segments) {
    for (let frame = segment.start; frame <= segment.end; frame += 1) {
      layout.add(buildNativeDrawPackets(project, segment.motion, frame).packets);
      report("measuring", ++measuredFrames);
    }
  }
  const previewScale = plan.id === "000" && plan.form === "f" ? 2.25
    : plan.id === "009" && plan.form === "f" ? 0.82 : 1;
  const view = layout.finish(previewScale * 0.5, {
    maxPixels: plan.format === "png" ? undefined : utMotionVideoMaxPixels,
    pixelRatio: plan.format === "png" ? utMotionPngPixelRatio : 1,
    full: plan.full,
  });
  const { canvas, draw } = createMotionCanvas(image, view.width, view.height);
  const palette = plan.format === "gif" ? await createMotionPaletteSample(image, totalFrames, (index, scale) => {
    for (const segment of segments) {
      const count = segment.end - segment.start + 1;
      if (index < count) return buildNativeDrawPackets(project, segment.motion, segment.start + index, {
        scale: view.scale * scale, originX: view.originX * scale, originY: view.originY * scale,
      }).packets;
      index -= count;
    }
    throw new Error("Invalid palette sample frame");
  }, view.width, view.height) : undefined;
  const startSignal = once(port, "message");
  send({ kind: "ready", width: view.width, height: view.height, palette });
  await startSignal;
  report("rendering", 0);

  let completedFrames = 0;
  let previousPackets: readonly UtMotionDrawPacket[] | undefined;
  let previousPixels: Buffer | undefined;
  for (const segment of segments) {
    for (let frame = segment.start; frame <= segment.end; frame += 1) {
      const packets: readonly UtMotionDrawPacket[] = buildNativeDrawPackets(project, segment.motion, frame, view).packets;
      const unchanged = previousPackets?.length === packets.length && packets.every((packet, index) => {
        const previous = previousPackets![index];
        return packet.opacity === previous.opacity && packet.blendMode === previous.blendMode
          && packet.positions.every((value, offset) => value === previous.positions[offset])
          && packet.uvs.every((value, offset) => value === previous.uvs[offset]);
      });
      if (!unchanged) draw(packets);
      if (plan.format === "png") {
        send({ kind: "result", data: await canvas.encode("png") });
      } else {
        if (!unchanged || !previousPixels) previousPixels = canvas.data();
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(previousPixels!, (error) => error ? reject(error) : resolve());
        });
      }
      previousPackets = packets;
      completedFrames += 1;
      report("rendering", completedFrames);
    }
  }
  port.close();
}

void render();
