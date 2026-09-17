import { createHash } from "node:crypto";
import { MotionDrawPacket } from "./types";

function updateInt32(hash: ReturnType<typeof createHash>, value: number): void {
  const data = Buffer.allocUnsafe(4);
  data.writeInt32LE(value);
  hash.update(data);
}

function updateFloat64(hash: ReturnType<typeof createHash>, value: number): void {
  const data = Buffer.allocUnsafe(8);
  data.writeDoubleLE(value);
  hash.update(data);
}

export function hashMotionPackets(packets: readonly MotionDrawPacket[]): string {
  const hash = createHash("sha256");
  updateInt32(hash, packets.length);
  for (const packet of packets) {
    updateInt32(hash, packet.partIndex);
    updateInt32(hash, packet.blendMode);
    updateFloat64(hash, packet.opacity);
    updateInt32(hash, packet.positions.length);
    for (const value of packet.positions) updateFloat64(hash, value);
    updateInt32(hash, packet.uvs.length);
    for (const value of packet.uvs) updateFloat64(hash, value);
  }
  return hash.digest("hex");
}

export function findPacketDifference(
  legacy: readonly MotionDrawPacket[],
  rust: readonly MotionDrawPacket[],
): { packet?: number; field: string; legacy: unknown; rust: unknown } | undefined {
  if (legacy.length !== rust.length) {
    return { field: "packets.length", legacy: legacy.length, rust: rust.length };
  }
  for (let packetIndex = 0; packetIndex < legacy.length; packetIndex += 1) {
    const left = legacy[packetIndex];
    const right = rust[packetIndex];
    for (const field of ["partIndex", "blendMode", "opacity"] as const) {
      if (left[field] !== right[field]) {
        return { packet: packetIndex, field, legacy: left[field], rust: right[field] };
      }
    }
    for (const field of ["positions", "uvs"] as const) {
      if (left[field].length !== right[field].length) {
        return {
          packet: packetIndex,
          field: `${field}.length`,
          legacy: left[field].length,
          rust: right[field].length,
        };
      }
      for (let index = 0; index < left[field].length; index += 1) {
        if (left[field][index] !== right[field][index]) {
          return {
            packet: packetIndex,
            field: `${field}[${index}]`,
            legacy: left[field][index],
            rust: right[field][index],
          };
        }
      }
    }
  }
  return undefined;
}
