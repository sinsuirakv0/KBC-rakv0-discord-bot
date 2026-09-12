const EXPECTED_HEADERS = {
  imgcut: ["[imgcut]"],
  model: ["[modelanim:model]", "[modelanim:model2]", "[mamodel]"],
  animation: ["[modelanim:animation]", "[modelanim:animation2]", "[maanim]"],
};

const TWO_PI = Math.PI * 2;

export const DEFAULT_FRAME_RATE = 30;

// 公式ARM実装の符号付き整数除算と同じく、商を0方向へ丸める。
export function nativeDivide(numerator, denominator) {
  if (denominator === 0) throw new Error("0では除算できません");
  return Math.trunc(numerator / denominator);
}

function readLines(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function readInteger(line, label) {
  const value = Number(line);
  if (!Number.isInteger(value)) throw new Error(`${label} が整数ではありません: ${line}`);
  return value;
}

function readIntegerColumns(line, count, label) {
  const columns = line.split(",");
  if (columns.length < count) {
    throw new Error(`${label} の列数が不足しています: ${line}`);
  }

  const values = columns.slice(0, count).map((column, index) => {
    const value = Number(column.trim());
    if (!Number.isInteger(value)) {
      throw new Error(`${label} の ${index + 1} 列目が整数ではありません: ${line}`);
    }
    return value;
  });

  return { values, name: columns.slice(count).join(",").trim() };
}

function assertHeader(lines, expected, label) {
  if (!expected.includes(lines[0]?.toLowerCase())) {
    throw new Error(`${label} のヘッダーが不正です: ${lines[0] ?? "(空)"}`);
  }
}

export function parseImgCut(text) {
  const lines = readLines(text);
  assertHeader(lines, EXPECTED_HEADERS.imgcut, "imgcut");

  const version = readInteger(lines[1] ?? "", "imgcutのバージョン");
  const imageName = lines[2];
  const cutCount = readInteger(lines[3] ?? "", "imgcutの分割数");
  if (!imageName || cutCount < 0) {
    throw new Error("imgcut の画像名または分割数が不正です");
  }

  const cuts = Array.from({ length: cutCount }, (_, index) => {
    const row = readIntegerColumns(lines[4 + index] ?? "", 4, `imgcut #${index}`);
    const [x, y, width, height] = row.values;
    return { index, x, y, width, height, name: row.name };
  });

  return { version, imageName, cuts };
}

export function parseMaModel(text) {
  const lines = readLines(text);
  assertHeader(lines, EXPECTED_HEADERS.model, "mamodel");

  const version = readInteger(lines[1] ?? "", "mamodelのバージョン");
  const partCount = readInteger(lines[2] ?? "", "mamodelのパーツ数");
  if (partCount <= 0) throw new Error("mamodel のパーツ数が不正です");

  let cursor = 3;
  const parts = Array.from({ length: partCount }, (_, index) => {
    const row = readIntegerColumns(lines[cursor++] ?? "", 13, `mamodel part #${index}`);
    const values = row.values;
    return {
      index,
      parent: values[0],
      id: values[1],
      imageIndex: values[2],
      zIndex: values[3],
      x: values[4],
      y: values[5],
      pivotX: values[6],
      pivotY: values[7],
      scaleX: values[8],
      scaleY: values[9],
      angle: values[10],
      opacity: values[11],
      glow: values[12],
      name: row.name,
      values,
    };
  });

  let scaleUnit = 100;
  let angleUnit = 360;
  let opacityUnit = 255;
  if (version >= 1) {
    const scaleRow = readIntegerColumns(lines[cursor++] ?? "", 3, "mamodelの基準値");
    [scaleUnit, angleUnit, opacityUnit] = scaleRow.values;
  }
  if (scaleUnit === 0 || angleUnit === 0 || opacityUnit === 0) {
    throw new Error("mamodel の基準値に 0 は指定できません");
  }

  const configs = [];
  if (version >= 3) {
    const configCount = readInteger(lines[cursor++] ?? "", "mamodelの設定数");
    if (configCount < 0) throw new Error("mamodel の設定数が不正です");
    for (let index = 0; index < configCount; index += 1) {
      const row = readIntegerColumns(lines[cursor++] ?? "", 6, `mamodel config #${index}`);
      configs.push({ values: row.values, name: row.name });
    }
  }

  validateStaticParents(parts);
  return { version, parts, scaleUnit, angleUnit, opacityUnit, configs };
}

function validateStaticParents(parts) {
  for (const part of parts) {
    if (part.parent < -1 || part.parent >= parts.length || part.parent === part.index) {
      throw new Error(`mamodel part #${part.index} の親番号が不正です: ${part.parent}`);
    }
  }

  for (const part of parts) {
    const visited = new Set([part.index]);
    let parentIndex = part.parent;
    while (parentIndex >= 0) {
      if (visited.has(parentIndex)) {
        throw new Error(`mamodel part #${part.index} の親関係が循環しています`);
      }
      visited.add(parentIndex);
      parentIndex = parts[parentIndex].parent;
    }
  }
}

export function parseMaAnim(text) {
  const lines = readLines(text);
  assertHeader(lines, EXPECTED_HEADERS.animation, "maanim");

  const version = readInteger(lines[1] ?? "", "maanimのバージョン");
  const trackCount = readInteger(lines[2] ?? "", "maanimのトラック数");
  if (trackCount < 0) throw new Error("maanim のトラック数が不正です");

  let cursor = 3;
  const tracks = Array.from({ length: trackCount }, (_, index) => {
    const header = readIntegerColumns(lines[cursor++] ?? "", 5, `maanim track #${index}`);
    const keyCount = readInteger(lines[cursor++] ?? "", `maanim track #${index} のキー数`);
    if (keyCount < 0) throw new Error(`maanim track #${index} のキー数が不正です`);

    const keys = Array.from({ length: keyCount }, (_, keyIndex) => {
      const row = readIntegerColumns(lines[cursor++] ?? "", 4, `maanim track #${index} key #${keyIndex}`);
      const [frame, value, easing, easingPower] = row.values;
      if (easing < 0 || easing > 3) {
        throw new Error(`maanim track #${index} key #${keyIndex} の補間 ${easing} はv15.5.0で未対応です`);
      }
      return { frame, value, easing, easingPower };
    });

    const [partIndex, property, loop, min, max] = header.values;
    const offset = normalizeKeyFrames(keys, loop);
    return {
      partIndex,
      property,
      loop,
      min,
      max,
      name: header.name,
      keys,
      firstFrame: keys[0]?.frame ?? 0,
      lastFrame: keys.at(-1)?.frame ?? 0,
      offset,
    };
  });

  const maxFrame = Math.max(1, ...tracks.map(getTrackMaxFrame));
  return { version, tracks, maxFrame, frameCount: maxFrame + 1 };
}

// 公式と同じく、負の先頭キーまたは非単発トラックを0基準へ移す。
function normalizeKeyFrames(keys, loop) {
  if (keys.length === 0) return 0;
  const offset = keys[0].frame < 0 || loop !== 1 ? -keys[0].frame : 0;
  for (const key of keys) key.frame += offset;
  return offset;
}

function getTrackMaxFrame(track) {
  if (track.keys.length === 0) return 0;
  if (track.loop !== -1) {
    return track.loop > 1
      ? track.firstFrame + (track.lastFrame - track.firstFrame) * track.loop - track.offset
      : track.lastFrame - track.offset;
  }
  return track.lastFrame - Math.min(track.offset, 0);
}

export function createMotionProject({ image, imgcut, model, motions }) {
  if (!image || !imgcut || !model || !motions) {
    throw new Error("モーションプロジェクトの必須データが不足しています");
  }

  for (const [key, motion] of Object.entries(motions)) {
    for (const track of motion.tracks) {
      if (track.partIndex < 0 || track.partIndex >= model.parts.length) {
        throw new Error(`${key}: 存在しないパーツ #${track.partIndex} を参照しています`);
      }
      if (track.property === 2) {
        for (const animationKey of track.keys) {
          if (animationKey.value < 0 || animationKey.value >= imgcut.cuts.length) {
            throw new Error(`${key}: 存在しない分割画像 #${animationKey.value} を参照しています`);
          }
        }
      }
    }
  }

  return { image, imgcut, model, motions };
}

function resetPart(base, partCount, model) {
  return {
    ...base,
    base,
    parent: base.parent,
    zOrder: base.zIndex * partCount + base.index,
    scaleFactorX: model.scaleUnit,
    scaleFactorY: model.scaleUnit,
    opacityFactor: model.opacityUnit,
    flipX: 1,
    flipY: 1,
    nativeScaleX: 0,
    nativeScaleY: 0,
    nativeOpacity: 0,
    nativeFlipX: false,
    nativeFlipY: false,
    matrix: null,
    vertices: null,
  };
}

export function evaluateMotion(project, motionKey, frame, options = {}) {
  const motion = project.motions[motionKey];
  if (!motion) throw new Error(`不明なモーションです: ${motionKey}`);

  const frameCount = motion.maxFrame + 1;
  const normalizedFrame = positiveModulo(frame, frameCount);
  const currentFrame = Math.floor(normalizedFrame);
  const progress = normalizedFrame - currentFrame;
  const canInterpolate = options.interpolate === true
    && progress > Number.EPSILON
    && currentFrame < motion.maxFrame;

  let parts;
  if (options.interpolate === true) {
    const currentParts = evaluateIntegerPose(project, motion, currentFrame);
    if (!canInterpolate) {
      parts = currentParts;
    } else {
      const nextParts = evaluateIntegerPose(project, motion, currentFrame + 1);
      parts = interpolatePose(currentParts, nextParts, progress, project.model);
    }
    calculateInterpolatedTransforms(parts, project, options.facing ?? 1);
  } else {
    parts = evaluateIntegerPose(project, motion, currentFrame);
    calculateNativeTransforms(parts, project, options.facing ?? 1);
  }

  return parts.sort((left, right) => left.zOrder - right.zOrder);
}

function evaluateIntegerPose(project, motion, animationFrame) {
  const { model } = project;
  const parts = model.parts.map(part => resetPart(part, model.parts.length, model));

  for (const track of motion.tracks) {
    const trackFrame = resolveTrackFrame(track, animationFrame, motion.maxFrame);
    const value = evaluateTrack(track, trackFrame);
    if (value !== undefined) applyProperty(parts[track.partIndex], track.property, value, parts, model);
  }

  validateAnimatedParents(parts);
  return parts;
}

// 最終頂点ではなくローカル変換を混ぜ、回転中の四角形が潰れることを防ぐ。
function interpolatePose(currentParts, nextParts, progress, model) {
  return currentParts.map((current, index) => {
    const next = nextParts[index];
    const part = {
      ...current,
      matrix: null,
      vertices: null,
    };
    const hasStructuralChange = current.parent !== next.parent
      || current.flipX !== next.flipX
      || current.flipY !== next.flipY;
    if (hasStructuralChange) return part;

    part.x = interpolateNumber(current.x, next.x, progress);
    part.y = interpolateNumber(current.y, next.y, progress);
    part.pivotX = interpolateNumber(current.pivotX, next.pivotX, progress);
    part.pivotY = interpolateNumber(current.pivotY, next.pivotY, progress);
    part.scaleFactorX = interpolateNumber(current.scaleFactorX, next.scaleFactorX, progress);
    part.scaleFactorY = interpolateNumber(current.scaleFactorY, next.scaleFactorY, progress);
    const hasVisibilityGateSwitch = (current.opacityFactor === 0 && next.opacityFactor === model.opacityUnit)
      || (current.opacityFactor === model.opacityUnit && next.opacityFactor === 0);
    if (!hasVisibilityGateSwitch) {
      part.opacityFactor = interpolateNumber(current.opacityFactor, next.opacityFactor, progress);
    }
    part.angle = interpolateAngle(current.angle, next.angle, progress, model.angleUnit);
    part.scaleX = current.base.scaleX * part.scaleFactorX / model.scaleUnit;
    part.scaleY = current.base.scaleY * part.scaleFactorY / model.scaleUnit;
    part.opacity = current.base.opacity * part.opacityFactor / model.opacityUnit;
    return part;
  });
}

function interpolateNumber(current, next, progress) {
  return current + (next - current) * progress;
}

function interpolateAngle(current, next, progress, angleUnit) {
  let difference = next - current;
  if (angleUnit > 0) {
    difference = positiveModulo(difference + angleUnit / 2, angleUnit) - angleUnit / 2;
    if (difference === -angleUnit / 2 && next > current) difference = angleUnit / 2;
  }
  return current + difference * progress;
}

function positiveModulo(value, divisor) {
  if (divisor === 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

function resolveTrackFrame(track, animationFrame, animationMaxFrame) {
  const { loop, firstFrame, lastFrame, offset } = track;
  const loopLength = lastFrame - firstFrame;
  const modulus = loop === -1 ? lastFrame : animationMaxFrame + 1;
  let frame = modulus === 0 ? 0 : positiveModulo(animationFrame + offset, modulus);

  if (loop > 0 && loopLength !== 0) {
    if (frame > firstFrame + loop * loopLength) return lastFrame;
    if (frame > firstFrame && frame < firstFrame + loop * loopLength) {
      frame = firstFrame + positiveModulo(frame - firstFrame, loopLength);
    } else if (frame >= firstFrame + loop * loopLength) {
      frame = lastFrame;
    }
  }

  return frame;
}

function evaluateTrack(track, frame) {
  const { keys } = track;
  if (keys.length === 0 || frame < keys[0].frame) return undefined;

  for (let index = 0; index < keys.length; index += 1) {
    const current = keys[index];
    const next = keys[index + 1];
    if (frame === current.frame) return current.value;
    if (!next || frame <= current.frame || frame >= next.frame) continue;

    if (current.easing === 1) return current.value;
    if (current.easing === 3) return evaluateLagrange(keys, index, frame);

    const numerator = frame - current.frame;
    const denominator = next.frame - current.frame;
    if (current.easing === 0) {
      return current.value + nativeDivide((next.value - current.value) * numerator, denominator);
    }

    const progress = numerator / denominator;
    const power = current.easingPower;
    const eased = power < 0
      ? Math.sqrt(1 - Math.pow(1 - progress, -power))
      : 1 - Math.sqrt(1 - Math.pow(progress, power));
    return Math.trunc(current.value + (next.value - current.value) * eased);
  }

  return frame > keys.at(-1).frame ? keys.at(-1).value : undefined;
}

function evaluateLagrange(keys, index, frame) {
  let low = index;
  let high = index;
  while (low > 0 && keys[low - 1].easing === 3) low -= 1;
  while (high < keys.length - 1) {
    high += 1;
    if (keys[high].easing !== 3) break;
  }

  let sum = 0n;
  for (let current = low; current <= high; current += 1) {
    let value = BigInt(keys[current].value) << 12n;
    for (let other = low; other <= high; other += 1) {
      if (other === current) continue;
      value = divideBigIntTowardZero(
        value * BigInt(frame - keys[other].frame),
        BigInt(keys[current].frame - keys[other].frame),
      );
    }
    sum += value;
  }
  return Number(divideBigIntTowardZero(sum, 4096n));
}

function divideBigIntTowardZero(numerator, denominator) {
  if (denominator === 0n) throw new Error("ラグランジュ補間のフレームが重複しています");
  return numerator / denominator;
}

function applyProperty(part, property, value, parts, model) {
  const base = part.base;
  if (property === 0) {
    const parentIndex = Math.trunc(value);
    part.parent = isValidAnimatedParent(part, parentIndex, parts)
      ? parentIndex
      : part.index === 0 ? -1 : 0;
  }
  else if (property === 1) part.id = Math.trunc(value);
  else if (property === 2) part.imageIndex = Math.trunc(value);
  else if (property === 3) {
    part.zIndex = Math.trunc(value);
    part.zOrder = part.zIndex * parts.length + part.index;
  } else if (property === 4) part.x = base.x + value;
  else if (property === 5) part.y = base.y + value;
  else if (property === 6) part.pivotX = base.pivotX + value;
  else if (property === 7) part.pivotY = base.pivotY + value;
  else if (property === 8) {
    part.scaleFactorX = value;
    part.scaleFactorY = value;
    part.scaleX = nativeDivide(base.scaleX * value, model.scaleUnit);
    part.scaleY = nativeDivide(base.scaleY * value, model.scaleUnit);
  } else if (property === 9) {
    part.scaleFactorX = value;
    part.scaleX = nativeDivide(base.scaleX * value, model.scaleUnit);
  } else if (property === 10) {
    part.scaleFactorY = value;
    part.scaleY = nativeDivide(base.scaleY * value, model.scaleUnit);
  } else if (property === 11) part.angle = base.angle + value;
  else if (property === 12) {
    part.opacityFactor = value;
    part.opacity = nativeDivide(base.opacity * value, model.opacityUnit);
  } else if (property === 13) part.flipX = value === 0 ? 1 : -1;
  else if (property === 14) part.flipY = value === 0 ? 1 : -1;
}

function isValidAnimatedParent(part, parentIndex, parts) {
  if (parentIndex < 0 || parentIndex >= parts.length || parentIndex === part.index) return false;
  const visited = new Set([part.index]);
  let currentIndex = parentIndex;
  while (currentIndex >= 0) {
    if (visited.has(currentIndex)) return false;
    visited.add(currentIndex);
    currentIndex = parts[currentIndex]?.parent ?? -1;
  }
  return true;
}

// 公式データでは発生しない循環でブラウザが停止しないよう、動的な親変更だけを安全化する。
function validateAnimatedParents(parts) {
  for (const part of parts) {
    if (part.parent < -1 || part.parent >= parts.length || part.parent === part.index) {
      part.parent = part.index === 0 ? -1 : 0;
    }

    const visited = new Set([part.index]);
    let parentIndex = part.parent;
    while (parentIndex >= 0) {
      if (visited.has(parentIndex)) {
        part.parent = part.index === 0 ? -1 : 0;
        break;
      }
      visited.add(parentIndex);
      parentIndex = parts[parentIndex]?.parent ?? -1;
    }
  }
}

function calculateNativeTransforms(parts, project, facing) {
  calculateTransforms(parts, project, facing, false);
}

function calculateInterpolatedTransforms(parts, project, facing) {
  calculateTransforms(parts, project, facing, true);
}

function calculateTransforms(parts, project, facing, interpolated) {
  const pending = new Set(parts.map(part => part.index));
  const completed = new Set([-1]);
  while (pending.size > 0) {
    let progressed = false;
    for (const index of [...pending]) {
      const part = parts[index];
      if (!completed.has(part.parent)) continue;
      calculatePartTransform(
        part,
        part.parent >= 0 ? parts[part.parent] : null,
        project,
        facing,
        interpolated,
      );
      pending.delete(index);
      completed.add(index);
      progressed = true;
    }
    if (!progressed) throw new Error("アニメーション後の親関係を解決できません");
  }
}

function calculatePartTransform(part, parent, project, facing, interpolated) {
  const { model, imgcut } = project;
  const scaleUnit = model.scaleUnit;
  const opacityUnit = model.opacityUnit;
  const divide = interpolated ? divideInterpolated : nativeDivide;
  const transform = interpolated ? transformInterpolatedPoint : transformPoint;
  part.usesInterpolatedMath = interpolated;

  if (!parent) {
    part.nativeScaleX = divide(part.base.scaleX * part.scaleFactorX, scaleUnit);
    part.nativeScaleY = divide(part.base.scaleY * part.scaleFactorY, scaleUnit);
    part.nativeOpacity = divide(part.base.opacity * part.opacityFactor, opacityUnit);
    if (facing < 0) part.nativeScaleX = -part.nativeScaleX;
    part.nativeFlipX = part.flipX < 0;
    part.nativeFlipY = part.flipY < 0;
    part.matrix = createTranslationMatrix(part.x, part.y);
  } else {
    part.nativeScaleX = divide(
      divide(part.base.scaleX * part.scaleFactorX * parent.nativeScaleX, scaleUnit),
      scaleUnit,
    );
    part.nativeScaleY = divide(
      divide(part.base.scaleY * part.scaleFactorY * parent.nativeScaleY, scaleUnit),
      scaleUnit,
    );
    part.nativeOpacity = divide(
      divide(part.base.opacity * part.opacityFactor * parent.nativeOpacity, opacityUnit),
      opacityUnit,
    );
    part.nativeFlipX = (part.flipX < 0) !== parent.nativeFlipX;
    part.nativeFlipY = (part.flipY < 0) !== parent.nativeFlipY;
    part.matrix = translateMatrix(
      parent.matrix,
      divide(parent.nativeScaleX * part.x, scaleUnit),
      divide(parent.nativeScaleY * part.y, scaleUnit),
    );
  }

  if (part.flipX < 0) part.nativeScaleX = -part.nativeScaleX;
  if (part.flipY < 0) part.nativeScaleY = -part.nativeScaleY;

  let angle = part.angle * TWO_PI / model.angleUnit;
  if (facing < 0) angle = -angle;
  if (part.nativeFlipX !== part.nativeFlipY) angle = -angle;
  part.matrix = rotateMatrix(part.matrix, angle);

  const cut = imgcut.cuts[part.imageIndex];
  if (!cut || part.id < 0 || part.imageIndex < 0) return;

  const left = divide(-part.nativeScaleX * part.pivotX, scaleUnit);
  const top = divide(-part.nativeScaleY * part.pivotY, scaleUnit);
  const right = left + divide(part.nativeScaleX * cut.width, scaleUnit);
  const bottom = top + divide(part.nativeScaleY * cut.height, scaleUnit);
  part.vertices = [
    transform(part.matrix, left, top),
    transform(part.matrix, left, bottom),
    transform(part.matrix, right, bottom),
    transform(part.matrix, right, top),
  ];
}

function divideInterpolated(numerator, denominator) {
  if (denominator === 0) throw new Error("0では除算できません");
  return numerator / denominator;
}

function createTranslationMatrix(x, y) {
  return [1, 0, Math.fround(x), 0, 1, Math.fround(y)];
}

function translateMatrix(matrix, x, y) {
  const result = matrix.slice();
  result[2] = Math.fround(matrix[2] + Math.fround(matrix[1] * y) + Math.fround(matrix[0] * x));
  result[5] = Math.fround(matrix[5] + Math.fround(matrix[4] * y) + Math.fround(matrix[3] * x));
  return result;
}

function rotateMatrix(matrix, angle) {
  if (angle === 0) return matrix;
  const sine = Math.fround(Math.sin(Math.fround(angle)));
  const cosine = Math.fround(Math.cos(Math.fround(angle)));
  const [a, b, tx, c, d, ty] = matrix;
  return [
    Math.fround(Math.fround(sine * b) + Math.fround(a * cosine)),
    Math.fround(Math.fround(cosine * b) - Math.fround(a * sine)),
    tx,
    Math.fround(Math.fround(sine * d) + Math.fround(c * cosine)),
    Math.fround(Math.fround(cosine * d) - Math.fround(c * sine)),
    ty,
  ];
}

function transformPoint(matrix, x, y) {
  return {
    x: Math.trunc(Math.fround(matrix[2] + Math.fround(matrix[1] * y) + Math.fround(matrix[0] * x))),
    y: Math.trunc(Math.fround(matrix[5] + Math.fround(matrix[4] * y) + Math.fround(matrix[3] * x))),
  };
}

function transformInterpolatedPoint(matrix, x, y) {
  return {
    x: Math.fround(matrix[2] + Math.fround(matrix[1] * y) + Math.fround(matrix[0] * x)),
    y: Math.fround(matrix[5] + Math.fround(matrix[4] * y) + Math.fround(matrix[3] * x)),
  };
}

function calculateModelAnchor(parts, model) {
  const config = model.configs[0]?.values;
  if (!config) return { x: 0, y: 0 };
  const targetIndex = config[0] < 0 ? 0 : config[0];
  const target = parts.find(part => part.index === targetIndex);
  if (!target?.matrix) return { x: 0, y: 0 };
  const divide = target.usesInterpolatedMath ? divideInterpolated : nativeDivide;
  const transform = target.usesInterpolatedMath ? transformInterpolatedPoint : transformPoint;
  const localX = divide((config[2] - target.pivotX) * target.nativeScaleX, model.scaleUnit);
  const localY = divide((config[3] - target.pivotY) * target.nativeScaleY, model.scaleUnit);
  return transform(target.matrix, localX, localY);
}

export function buildNativeDrawPackets(project, motionKey, frame, options = {}) {
  const {
    originX = 0,
    originY = 0,
    scale = 1,
    facing = 1,
    alpha = 1,
    useModelAnchor = true,
    interpolate = false,
  } = options;
  const parts = evaluateMotion(project, motionKey, frame, { facing, interpolate });
  const anchor = useModelAnchor ? calculateModelAnchor(parts, project.model) : { x: 0, y: 0 };
  const imageWidth = project.image.naturalWidth || project.image.width;
  const imageHeight = project.image.naturalHeight || project.image.height;
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    throw new Error("スプライトシートの寸法を取得できません");
  }

  let blendMode = 0;
  const packets = [];
  for (const part of parts) {
    if (!part.vertices) continue;
    const cut = project.imgcut.cuts[part.imageIndex];
    if (!cut) continue;
    if (part.glow >= 0 && part.glow < 4) blendMode = part.glow;
    const opacityByte = part.usesInterpolatedMath
      ? part.nativeOpacity * 255 / project.model.opacityUnit
      : nativeDivide(part.nativeOpacity * 255, project.model.opacityUnit);
    if (opacityByte === 0) continue;

    packets.push({
      partIndex: part.index,
      blendMode,
      opacity: Math.max(0, Math.min(1, opacityByte / 255 * alpha)),
      positions: part.vertices.flatMap(vertex => [
        originX + (vertex.x - anchor.x) * scale,
        originY + (vertex.y - anchor.y) * scale,
      ]),
      uvs: [
        cut.x / imageWidth,
        cut.y / imageHeight,
        cut.x / imageWidth,
        (cut.y + cut.height) / imageHeight,
        (cut.x + cut.width) / imageWidth,
        (cut.y + cut.height) / imageHeight,
        (cut.x + cut.width) / imageWidth,
        cut.y / imageHeight,
      ],
    });
  }

  return { parts, packets, anchor };
}

export function drawMotionFrame(renderer, project, motionKey, frame, options = {}) {
  if (!renderer || typeof renderer.drawPackets !== "function") {
    throw new Error("drawMotionFrameにはNativeWebGLRendererが必要です");
  }
  const result = buildNativeDrawPackets(project, motionKey, frame, options);
  renderer.drawPackets(project.image, result.packets);
  return result.parts;
}
