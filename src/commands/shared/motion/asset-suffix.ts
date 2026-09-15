import { MotionKind } from "./types";

const FILE_INDEX: Readonly<Record<MotionKind, number>> = {
  move: 0,
  idle: 1,
  attack: 2,
  knockback: 3,
};

export function buildMotionAnimationSuffix(stem: string, motion: MotionKind): string {
  return `_${stem}0${FILE_INDEX[motion]}.maanim`;
}
