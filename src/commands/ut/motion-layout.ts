import {
  utMotionMaxDimension,
  utMotionMaxPixels,
  utMotionPadding,
  utMotionViewportBottomMargin,
  utMotionViewportSideMargin,
  utMotionViewportTopMargin,
} from "../../config/ut";
import { UtMotionDrawPacket } from "./types";

export interface MotionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const emptyBounds = (): MotionBounds => ({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

function include(target: MotionBounds, source: MotionBounds): void {
  target.left = Math.min(target.left, source.left);
  target.top = Math.min(target.top, source.top);
  target.right = Math.max(target.right, source.right);
  target.bottom = Math.max(target.bottom, source.bottom);
}

export function createMotionLayout(
  getVisibleBounds: (packet: UtMotionDrawPacket) => MotionBounds | undefined,
  referencePackets: readonly UtMotionDrawPacket[] = [],
) {
  const parts = new Map<number, MotionBounds>();
  function measure(packet: UtMotionDrawPacket): MotionBounds | undefined {
    if (packet.opacity <= 0) return undefined;
    const visible = getVisibleBounds(packet);
    if (!visible) return undefined;
    const p = packet.positions;
    const dx = [p[6] - p[0], p[7] - p[1]];
    const dy = [p[2] - p[0], p[3] - p[1]];
    const bounds = emptyBounds();
    for (const x of [visible.left, visible.right]) {
      for (const y of [visible.top, visible.bottom]) {
        const px = p[0] + x * dx[0] + y * dy[0];
        const py = p[1] + x * dx[1] + y * dy[1];
        include(bounds, { left: px, top: py, right: px, bottom: py });
      }
    }
    if (!Object.values(bounds).every(Number.isFinite)) throw new Error("Invalid motion geometry");
    return bounds.left < bounds.right && bounds.top < bounds.bottom ? bounds : undefined;
  }
  const reference = emptyBounds();
  for (const packet of referencePackets) {
    const bounds = measure(packet);
    if (bounds) include(reference, bounds);
  }

  return {
    add(packets: readonly UtMotionDrawPacket[]): void {
      for (const packet of packets) {
        const bounds = measure(packet);
        if (!bounds) continue;
        const part = parts.get(packet.partIndex) ?? emptyBounds();
        include(part, bounds);
        parts.set(packet.partIndex, part);
      }
    },
    finish(previewScale: number, { maxPixels = utMotionMaxPixels, full = false, pixelRatio = 1 } = {}) {
      const bounds = emptyBounds();
      const clippedParts: number[] = [];
      for (const part of parts.values()) include(bounds, part);
      if (!full && Number.isFinite(reference.left)) {
        // 初期姿勢の周囲だけを拡張し、長い光線と遠方へ動く演出の両方を制限する。
        const span = Math.max(reference.right - reference.left, reference.bottom - reference.top);
        const limit = {
          left: reference.left - span * utMotionViewportSideMargin,
          right: reference.right + span * utMotionViewportSideMargin,
          top: reference.top - span * utMotionViewportTopMargin,
          bottom: reference.bottom + span * utMotionViewportBottomMargin,
        };
        const cropped = {
          left: Math.max(bounds.left, limit.left), top: Math.max(bounds.top, limit.top),
          right: Math.min(bounds.right, limit.right), bottom: Math.min(bounds.bottom, limit.bottom),
        };
        // 初期姿勢が空、または指定フレームと全く重ならない場合は空白画像にしない。
        if (cropped.left < cropped.right && cropped.top < cropped.bottom) {
          for (const [index, part] of parts) {
            if (part.left < cropped.left || part.top < cropped.top || part.right > cropped.right || part.bottom > cropped.bottom) {
              clippedParts.push(index);
            }
          }
          Object.assign(bounds, cropped);
        }
      }
      if (!Number.isFinite(bounds.left)) Object.assign(bounds, { left: -16, top: -32, right: 16, bottom: 0 });
      const sourceWidth = Math.max(1, bounds.right - bounds.left);
      const sourceHeight = Math.max(1, bounds.bottom - bounds.top);
      const padding = utMotionPadding * 2;
      // 偶数への切り上げと余白を含めても画素数の上限を超えないようにする。
      let scale = Math.min(previewScale,
        (utMotionMaxDimension - padding - 2) / Math.max(sourceWidth, sourceHeight));
      const areaAt = (value: number) => (sourceWidth * value + padding + 2) * (sourceHeight * value + padding + 2);
      if (areaAt(scale) > maxPixels) {
        let low = 0;
        let high = scale;
        for (let step = 0; step < 24; step += 1) {
          const middle = (low + high) / 2;
          if (areaAt(middle) > maxPixels) high = middle;
          else low = middle;
        }
        scale = low;
      }
      const width = Math.max(32, Math.ceil((sourceWidth * scale + padding) / 2) * 2);
      const height = Math.max(32, Math.ceil((sourceHeight * scale + padding) / 2) * 2);
      return {
        width: width * pixelRatio, height: height * pixelRatio, scale: scale * pixelRatio, clippedParts,
        originX: ((width - sourceWidth * scale) / 2 - bounds.left * scale) * pixelRatio,
        originY: (height - utMotionPadding - bounds.bottom * scale) * pixelRatio,
      };
    },
  };
}
