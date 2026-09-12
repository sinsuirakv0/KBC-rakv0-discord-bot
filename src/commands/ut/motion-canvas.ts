import { Canvas, createCanvas, Image } from "@napi-rs/canvas";
import { utMotionHeight, utMotionWidth } from "../../config/ut";

interface DrawPacket {
  positions: number[];
  uvs: number[];
  opacity: number;
  blendMode: number;
}

const BLEND_MODES = ["source-over", "lighter", "multiply", "screen"] as const;

export function createMotionCanvas(image: Image) {
  const canvas = createCanvas(utMotionWidth, utMotionHeight);
  const context = canvas.getContext("2d");
  let multiplyLayer: Canvas | undefined;

  function draw(packets: readonly DrawPacket[]): void {
    context.fillStyle = "#252a32";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const packet of packets) {
      const positions = packet.positions;
      const uvs = packet.uvs;
      const x = Math.round(uvs[0] * image.width);
      const y = Math.round(uvs[1] * image.height);
      const width = Math.round((uvs[6] - uvs[0]) * image.width);
      const height = Math.round((uvs[3] - uvs[1]) * image.height);
      if (width <= 0 || height <= 0) continue;

      context.save();
      context.globalAlpha = packet.opacity;
      context.globalCompositeOperation = BLEND_MODES[packet.blendMode];
      context.setTransform(
        (positions[6] - positions[0]) / width,
        (positions[7] - positions[1]) / width,
        (positions[2] - positions[0]) / height,
        (positions[3] - positions[1]) / height,
        positions[0], positions[1],
      );

      if (packet.blendMode === 2) {
        // ネイティブのDST_COLOR/ZEROは、透明部分も黒として乗算する。
        if (!multiplyLayer) multiplyLayer = createCanvas(width, height);
        if (multiplyLayer.width !== width) multiplyLayer.width = width;
        if (multiplyLayer.height !== height) multiplyLayer.height = height;
        const layerContext = multiplyLayer.getContext("2d");
        layerContext.globalAlpha = 1;
        layerContext.fillStyle = "#000000";
        layerContext.fillRect(0, 0, width, height);
        layerContext.globalAlpha = packet.opacity;
        layerContext.drawImage(image, x, y, width, height, 0, 0, width, height);
        context.globalAlpha = 1;
        context.drawImage(multiplyLayer, 0, 0);
      } else {
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
      }
      context.restore();
    }
  }

  return { canvas, draw };
}
