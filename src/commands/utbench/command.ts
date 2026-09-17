import { motionProgressIntervalMs } from "../../config/motion";
import { InteractiveCommandOutput } from "../types";
import { createUtCommand } from "../ut/command";
import { remoteUtDataSource } from "../ut/data-source";
import { prepareUtMotion } from "../ut/motion-request";
import {
  UtDataSource,
  UtMotionRequest,
  UtSearchMatch,
} from "../ut/types";
import { motionBenchmarkRenderer } from "../shared/motion/benchmark-renderer";
import {
  MotionBenchmarkEngine,
  MotionBenchmarkRenderer,
} from "../shared/motion/benchmark-types";
import { formatMotionProgress } from "../shared/motion/progress";
import { UtMotionTimeoutError } from "../ut/motion-timeout";
import { formatMotionBenchmarkResult } from "./formatters";

const DATA_ERROR_MESSAGE =
  "味方キャラデータの取得に失敗しました。しばらくしてからもう一度お試しください。";
const MISSING_MOTION_MESSAGE = "指定したモーションはこのキャラには存在しません。";
const INVALID_FRAME_MESSAGE = "指定したフレームはこのモーションには存在しません。";
const RENDER_ERROR_MESSAGE =
  "モーション比較の生成に失敗しました。しばらくしてからもう一度お試しください。";

export interface UtBenchCommandDependencies {
  dataSource: UtDataSource;
  benchmarkRenderer?: MotionBenchmarkRenderer;
}

function engineLabel(engine: MotionBenchmarkEngine): string {
  return engine === "legacy" ? "Legacy" : "Rust";
}

async function sendBenchmark(
  match: UtSearchMatch,
  request: UtMotionRequest,
  dataSource: UtDataSource,
  output: InteractiveCommandOutput,
  renderer: MotionBenchmarkRenderer,
): Promise<void> {
  const message = await output.send("motion benchmark: データを確認しています…");
  const prepared = await prepareUtMotion(match, request, dataSource);
  if (prepared.kind === "data-error") {
    await message.edit(DATA_ERROR_MESSAGE);
    return;
  }
  if (prepared.kind === "missing") {
    await message.edit(MISSING_MOTION_MESSAGE);
    return;
  }
  let previousTime = -Infinity;
  let previousStage = "";
  try {
    const result = await renderer.render(
      prepared.plan,
      (relativePath) => dataSource.fetchAsset(relativePath),
      (engine, progress) => {
        const stage = `${engine}:${progress.stage}`;
        const now = Date.now();
        if (stage === previousStage && now - previousTime < motionProgressIntervalMs) return;
        previousStage = stage;
        previousTime = now;
        void message.edit(
          `motion benchmark\n${engineLabel(engine)}: ${formatMotionProgress(progress)}`,
        ).catch((error) => console.error("Motion benchmark progress update failed.", error));
      },
    );
    if (!result) {
      await message.edit(INVALID_FRAME_MESSAGE);
      return;
    }
    await message.edit("motion benchmark: 生成結果を送信しています…");
    await output.sendAttachment(result.legacy.attachment);
    await output.sendAttachment(result.rust.attachment);
    await message.edit(formatMotionBenchmarkResult(
      `${match.unit.id}-${request.form}`,
      result,
    ));
  } catch (error) {
    console.error("Ut motion benchmark failed.", error);
    await message.edit(error instanceof UtMotionTimeoutError
      ? "モーション比較が時間制限に達しました。フレーム範囲を短くして、もう一度お試しください。"
      : RENDER_ERROR_MESSAGE);
  }
}

export function createUtBenchCommand(dependencies: UtBenchCommandDependencies) {
  const renderer = dependencies.benchmarkRenderer ?? motionBenchmarkRenderer;
  return createUtCommand({
    dataSource: dependencies.dataSource,
    commandName: "utbench",
    administratorOnly: true,
    motionOnly: true,
    motionHandler: (match, request, dataSource, output) =>
      sendBenchmark(match, request, dataSource, output, renderer),
  });
}

export const utBenchCommand = createUtBenchCommand({ dataSource: remoteUtDataSource });
