import { Canvas, createCanvas, Image } from "@napi-rs/canvas";
import { MotionBounds } from "./motion-layout";
import { UtMotionDrawPacket } from "./types";

const BLEND_MODES = ["source-over", "lighter", "multiply", "screen"] as const;

export function createVisibleCutBounds(
  image: Image,
  cuts: readonly { x: number; y: number; width: number; height: number }[],
) {
  const source = createCanvas(image.width, image.height);
  const context = source.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const bounds = new Map<string, { normal?: MotionBounds; light?: MotionBounds }>();
  for (const cut of cuts) {
    let left = cut.width, top = cut.height, right = 0, bottom = 0;
    let lightLeft = cut.width, lightTop = cut.height, lightRight = 0, lightBottom = 0;
    for (let y = Math.max(0, cut.y); y < Math.min(image.height, cut.y + cut.height); y += 1) {
      for (let x = Math.max(0, cut.x); x < Math.min(image.width, cut.x + cut.width); x += 1) {
        const offset = (y * image.width + x) * 4;
        if (pixels[offset + 3] === 0) continue;
        left = Math.min(left, x - cut.x);
        top = Math.min(top, y - cut.y);
        right = Math.max(right, x - cut.x + 1);
        bottom = Math.max(bottom, y - cut.y + 1);
        if (pixels[offset] || pixels[offset + 1] || pixels[offset + 2]) {
          lightLeft = Math.min(lightLeft, x - cut.x);
          lightTop = Math.min(lightTop, y - cut.y);
          lightRight = Math.max(lightRight, x - cut.x + 1);
          lightBottom = Math.max(lightBottom, y - cut.y + 1);
        }
      }
    }
    const key = [cut.x, cut.y, cut.width, cut.height].join(",");
    bounds.set(key, {
      normal: right > left && bottom > top ? {
        left: left / cut.width, top: top / cut.height, right: right / cut.width, bottom: bottom / cut.height,
      } : undefined,
      light: lightRight > lightLeft && lightBottom > lightTop ? {
        left: lightLeft / cut.width, top: lightTop / cut.height, right: lightRight / cut.width, bottom: lightBottom / cut.height,
      } : undefined,
    });
  }
  return (packet: UtMotionDrawPacket): MotionBounds | undefined => {
    // 乗算では透明領域も黒くなるため、切り抜き全体が表示範囲になる。
    if (packet.blendMode === 2) return { left: 0, top: 0, right: 1, bottom: 1 };
    const u = packet.uvs;
    const cut = bounds.get([
      Math.round(u[0] * image.width), Math.round(u[1] * image.height),
      Math.round((u[6] - u[0]) * image.width), Math.round((u[3] - u[1]) * image.height),
    ].join(","));
    return packet.blendMode === 1 || packet.blendMode === 3 ? cut?.light : cut?.normal;
  };
}

export function createMotionCanvas(image: Image, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  let multiplyLayer: Canvas | undefined;

  function draw(packets: readonly UtMotionDrawPacket[]): void {
    context.resetTransform();
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#252a32";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const packet of packets) {
      const positions = packet.positions;
      const uvs = packet.uvs;
      const x = Math.round(uvs[0] * image.width);
      const y = Math.round(uvs[1] * image.height);
      const width = Math.round((uvs[6] - uvs[0]) * image.width);
      const height = Math.round((uvs[3] - uvs[1]) * image.height);
      if (width <= 0 || height <= 0 || packet.opacity <= 0) continue;

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
    }
  }

  return { canvas, draw };
}
