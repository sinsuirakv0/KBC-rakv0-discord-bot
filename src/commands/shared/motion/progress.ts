import { motionProgressIntervalMs } from "../../../config/motion";
import { SentCommandMessage } from "../../types";
import { MotionProgress } from "./types";

export function formatMotionProgress(progress: MotionProgress): string {
  switch (progress.stage) {
    case "queued": return "モーション生成の順番待ちです…";
    case "loading": return "モーションのデータを取得しています…";
    case "encoding": return "モーションの動画変換を仕上げています…";
    case "sending": return "モーションを送信しています…";
    case "measuring":
    case "rendering": {
      const { completedFrames, totalFrames } = progress;
      const percent = Math.floor(completedFrames * 100 / totalFrames);
      const action = progress.stage === "measuring" ? "モーションの表示範囲を確認しています" : "モーションを生成しています";
      return `${action}… ${percent}%（${completedFrames}/${totalFrames}フレーム）`;
    }
  }
}

export function createMotionProgress(
  message: SentCommandMessage,
  now: () => number = Date.now,
) {
  let updates: Promise<void> | undefined;
  let pendingText: string | undefined;
  let previousText = "";
  let previousStage: MotionProgress["stage"] | undefined;
  let previousTime = -Infinity;
  let finished = false;

  async function drain(): Promise<void> {
    await Promise.resolve();
    while (pendingText !== undefined) {
      const nextText = pendingText;
      pendingText = undefined;
      if (nextText === previousText) continue;
      previousText = nextText;
      try { await message.edit(nextText); }
      catch (error) { console.error("Motion progress update failed.", error); }
    }
    updates = undefined;
  }

  function edit(content: string): Promise<void> {
    pendingText = content;
    if (!updates) updates = drain();
    return updates;
  }

  return {
    update(progress: MotionProgress): Promise<void> {
      if (finished) return updates ?? Promise.resolve();
      const currentTime = now();
      if (progress.stage === previousStage && currentTime - previousTime < motionProgressIntervalMs) {
        return updates ?? Promise.resolve();
      }
      previousStage = progress.stage;
      previousTime = currentTime;
      return edit(formatMotionProgress(progress));
    },
    finish(content: string): Promise<void> {
      finished = true;
      return edit(content);
    },
  };
}
