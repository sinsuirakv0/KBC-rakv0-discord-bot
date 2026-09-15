import { MotionKind, MotionRequest, MotionSegment } from "./types";

const MOTION_KINDS: Readonly<Record<string, MotionKind>> = {
  a: "attack",
  w: "move",
  i: "idle",
  k: "knockback",
};

function parseNonNegativeInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseCompactRange(value: string): { start: number; end: number } | undefined {
  const match = value.match(/^(\d+)~~(\d+)$/);
  if (!match) return undefined;
  const start = parseNonNegativeInteger(match[1]);
  const end = parseNonNegativeInteger(match[2]);
  return start !== undefined && end !== undefined && start <= end
    ? { start, end }
    : undefined;
}

export function parseMotionArguments(
  args: readonly string[],
  forms: readonly string[] = [],
): (MotionRequest & { form?: string }) | undefined {
  const tokens = args.map((value) => value.toLowerCase());
  const format = tokens[0];
  if (format !== "png" && format !== "mp4" && format !== "gif") return undefined;
  const fullFlags = tokens.filter((value) => value === "--full");
  if (fullFlags.length > 1) return undefined;
  const full = fullFlags.length === 1;
  const normalized = tokens.filter((value) => value !== "--full");

  let cursor = 1;
  let form: string | undefined;
  if (forms.includes(normalized[cursor])) {
    form = normalized[cursor];
    cursor += 1;
  }

  if (format === "png") {
    const motion = MOTION_KINDS[normalized[cursor]];
    if (!motion || normalized.length > cursor + 2) return undefined;
    const rawFrame = normalized[cursor + 1];
    const frame = rawFrame === undefined ? 0 : parseNonNegativeInteger(rawFrame);
    return frame === undefined ? undefined : {
      format, full, form, segments: [{ motion, frame }],
    };
  }

  const segments: MotionSegment[] = [];
  while (cursor < normalized.length) {
    const motion = MOTION_KINDS[normalized[cursor]];
    if (!motion) return undefined;
    cursor += 1;
    if (cursor >= normalized.length || MOTION_KINDS[normalized[cursor]]) {
      segments.push({ motion });
      continue;
    }
    const compactRange = parseCompactRange(normalized[cursor]);
    if (compactRange) {
      segments.push({ motion, range: compactRange });
      cursor += 1;
      continue;
    }
    const start = parseNonNegativeInteger(normalized[cursor]);
    const end = parseNonNegativeInteger(normalized[cursor + 1] ?? "");
    if (start === undefined || end === undefined || start > end) return undefined;
    segments.push({ motion, range: { start, end } });
    cursor += 2;
  }

  return segments.length > 0 ? { format, full, form, segments } : undefined;
}
