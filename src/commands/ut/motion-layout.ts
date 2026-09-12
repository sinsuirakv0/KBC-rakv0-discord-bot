import {
  utMotionMaxDimension,
  utMotionMaxPixels,
  utMotionOutlierMargin,
  utMotionOutlierRatio,
  utMotionPadding,
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
  image: { width: number; height: number },
) {
  const parts = new Map<number, { bounds: MotionBounds; longest: number; magnification: number }>();

  return {
    add(packets: readonly UtMotionDrawPacket[]): void {
      for (const packet of packets) {
        if (packet.opacity <= 0) continue;
        const visible = getVisibleBounds(packet);
        if (!visible) continue;
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
        const width = Math.hypot(...dx);
        const height = Math.hypot(...dy);
        const longest = Math.max(width * (visible.right - visible.left), height * (visible.bottom - visible.top));
        const magnification = Math.max(
          width / Math.max(1, (packet.uvs[6] - packet.uvs[0]) * image.width),
          height / Math.max(1, (packet.uvs[3] - packet.uvs[1]) * image.height),
        );
        if (!Number.isFinite(longest) || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top)) {
          throw new Error("Invalid motion geometry");
        }
        if (longest <= 0) continue;
        const part = parts.get(packet.partIndex) ?? { bounds: emptyBounds(), longest: 0, magnification: 0 };
        include(part.bounds, bounds);
        part.longest = Math.max(part.longest, longest);
        part.magnification = Math.max(part.magnification, magnification);
        parts.set(packet.partIndex, part);
      }
    },
    finish(previewScale: number, maxPixels = utMotionMaxPixels) {
      const ordered = [...parts.values()].map(part => part.longest).sort((a, b) => a - b);
      const threshold = (ordered[Math.floor((ordered.length - 1) * 0.9)] ?? Infinity) * utMotionOutlierRatio;
      const magnifications = [...parts.values()].map(part => part.magnification).sort((a, b) => a - b);
      const scaleThreshold = (magnifications[Math.floor((magnifications.length - 1) * 0.5)] ?? Infinity) * utMotionOutlierRatio;
      const bounds = emptyBounds();
      const clippedParts: number[] = [];
      for (const [index, part] of parts) {
        if (part.longest > threshold && part.magnification > scaleThreshold) clippedParts.push(index);
        else include(bounds, part.bounds);
      }
      if (!Number.isFinite(bounds.left)) Object.assign(bounds, { left: -16, top: -32, right: 16, bottom: 0 });

      // 通常パーツは必ず残し、極端な拡大パーツだけが画角を押し広げるのを防ぐ。
      const margin = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) * utMotionOutlierMargin;
      const limit = { left: bounds.left - margin, top: bounds.top - margin, right: bounds.right + margin, bottom: bounds.bottom };
      for (const index of clippedParts) {
        const source = parts.get(index)!.bounds;
        const clipped = {
          left: Math.max(source.left, limit.left), top: Math.max(source.top, limit.top),
          right: Math.min(source.right, limit.right), bottom: Math.min(source.bottom, limit.bottom),
        };
        if (clipped.left < clipped.right && clipped.top < clipped.bottom) include(bounds, clipped);
      }
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
        width, height, scale, clippedParts,
        originX: (width - sourceWidth * scale) / 2 - bounds.left * scale,
        originY: height - utMotionPadding - bounds.bottom * scale,
      };
    },
  };
}
