import { createCanvas, Image } from "@napi-rs/canvas";
import { utMotionPaletteSampleCount, utMotionPaletteSampleSize } from "../../config/ut";
import { UtMotionDrawPacket } from "./types";
import { createMotionCanvas } from "./motion-canvas";

export async function createMotionPaletteSample(
  image: Image,
  totalFrames: number,
  drawFrame: (index: number, scale: number) => readonly UtMotionDrawPacket[],
  width: number,
  height: number,
): Promise<Uint8Array> {
  const count = Math.min(utMotionPaletteSampleCount, totalFrames);
  const size = utMotionPaletteSampleSize;
  const columns = 4;
  const rows = Math.ceil(count / columns);
  const sheet = createCanvas(size * columns, size * (rows + 1));
  const context = sheet.getContext("2d");
  context.fillStyle = "#252a32";
  context.fillRect(0, 0, sheet.width, sheet.height);
  const scale = Math.min(size / width, size / height);
  const sampleWidth = Math.max(1, Math.ceil(width * scale));
  const sampleHeight = Math.max(1, Math.ceil(height * scale));
  const { canvas, draw } = createMotionCanvas(image, sampleWidth, sampleHeight);
  for (let sample = 0; sample < count; sample += 1) {
    const frame = count === 1 ? 0 : Math.round(sample * (totalFrames - 1) / (count - 1));
    draw(drawFrame(frame, scale));
    context.drawImage(canvas, sample % columns * size, Math.floor(sample / columns) * size);
  }
  // 短時間だけ現れる色も拾えるよう、元スプライトの色を見本へ加える。
  const spriteScale = Math.min(sheet.width / image.width, size / image.height);
  context.drawImage(image, 0, rows * size, image.width * spriteScale, image.height * spriteScale);
  return sheet.encode("png");
}
