import {
  tutPageSize,
  tutReactionTimeoutMs,
  tutSearchPageUrl,
} from "../../config/tut";
import { fileCommandHelpSource } from "../help/data-source";
import { CommandHelpSource } from "../help/types";
import { createMotionProgress } from "../shared/motion/progress";
import { motionRenderer as sharedMotionRenderer } from "../shared/motion/renderer";
import { MotionTimeoutError } from "../shared/motion/timeout";
import { MotionRenderer, MotionRequest } from "../shared/motion/types";
import { CommandContext, CommandDefinition, InteractiveCommandOutput } from "../types";
import { remoteTutDataSource } from "./data-source";
import { resolveEnemyMotionPlan, searchEnemies } from "./domain";
import {
  formatEnemyDetail,
  formatEnemyLabel,
  formatEnemyPage,
  formatEnemySelection,
  TUT_NEXT_PAGE_EMOJI,
  TUT_NUMBER_EMOJIS,
  TUT_PREVIOUS_PAGE_EMOJI,
} from "./formatters";
import { parseTutRequest } from "./parsers";
import { TutDataSource, TutSearchMatch } from "./types";

const NOT_FOUND_MESSAGE = "該当する敵ユニットが見つかりませんでした。";
const DATA_ERROR_MESSAGE =
  "敵データを取得できませんでした。時間をおいて再度お試しください。";
const IMAGE_ERROR_MESSAGE = "敵画像の取得に失敗しました。";
const INVALID_MOTION_MESSAGE =
  "motionの指定が正しくありません。o.tut help で使い方を確認してください。";
const MISSING_MOTION_MESSAGE = "指定したモーションはこの敵には存在しません。";
const INVALID_FRAME_MESSAGE = "指定したフレームはこのモーションには存在しません。";
const RENDER_ERROR_MESSAGE =
  "モーションの生成に失敗しました。しばらくしてからもう一度お試しください。";
const LIST_FOOTER = "詳細は o.tut <ID> で表示できます。";

export interface TutCommandDependencies {
  dataSource: TutDataSource;
  helpSource?: CommandHelpSource;
  reactionTimeoutMs?: number;
  pageSize?: number;
  motionRenderer?: MotionRenderer;
}

async function sendHelp(
  context: CommandContext,
  helpSource: CommandHelpSource,
): Promise<void> {
  try {
    await context.reply(await helpSource.read("tut"));
  } catch (error) {
    console.error("Command help retrieval failed: tut", error);
    await context.reply("ヘルプの読み込みに失敗しました。");
  }
}

async function sendEnemyImage(
  match: TutSearchMatch,
  dataSource: TutDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  try {
    await output.sendAttachment(await dataSource.fetchEnemyPng(match.enemy.id));
  } catch (error) {
    console.error("Enemy image retrieval failed.", error);
    await output.send(IMAGE_ERROR_MESSAGE);
  }
}

async function sendEnemyMotion(
  match: TutSearchMatch,
  request: MotionRequest,
  dataSource: TutDataSource,
  renderer: MotionRenderer,
  output: InteractiveCommandOutput,
): Promise<void> {
  const message = await output.send("モーションのデータを確認しています…");
  const progress = createMotionProgress(message);
  let assets;
  try {
    assets = await dataSource.fetchEnemyMotionAssets();
  } catch (error) {
    console.error("Enemy motion metadata retrieval failed.", error);
    await progress.finish(DATA_ERROR_MESSAGE);
    return;
  }
  const plan = resolveEnemyMotionPlan(assets, match.enemy.id, request);
  if (!plan) {
    await progress.finish(MISSING_MOTION_MESSAGE);
    return;
  }
  try {
    const attachment = await renderer.render(
      plan,
      (relativePath) => dataSource.fetchMotionAsset(relativePath),
      progress.update,
    );
    if (!attachment) {
      await progress.finish(INVALID_FRAME_MESSAGE);
      return;
    }
    await progress.update({ stage: "sending" });
    await output.sendAttachment(attachment);
    await progress.finish("モーションの生成・送信が完了しました。");
  } catch (error) {
    console.error("Enemy motion rendering failed.", error);
    await progress.finish(error instanceof MotionTimeoutError
      ? "モーションの処理が時間制限に達しました。フレーム範囲を短くして、もう一度お試しください。"
      : RENDER_ERROR_MESSAGE);
  }
}

async function selectEnemy(
  matches: readonly TutSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
): Promise<TutSearchMatch | undefined> {
  const message = await output.send(
    formatEnemySelection(query, matches, "数字のリアクションで選択してください。"),
  );
  const emojis = TUT_NUMBER_EMOJIS.slice(0, matches.length);
  for (const emoji of emojis) await message.react(emoji);
  const selectedEmoji = await message.waitForUserReaction(
    emojis,
    output.userId,
    timeoutMs,
  );
  if (!selectedEmoji) {
    await message.clearReactions();
    await message.edit(
      formatEnemySelection(query, matches, "選択受付は終了しました。"),
    );
    return undefined;
  }
  const selectedIndex = TUT_NUMBER_EMOJIS.indexOf(
    selectedEmoji as typeof TUT_NUMBER_EMOJIS[number],
  );
  const selected = matches[selectedIndex];
  if (!selected) return undefined;
  await message.clearReactions();
  await message.edit(
    formatEnemySelection(query, matches, `選択済み: ${formatEnemyLabel(selected)}`),
  );
  return selected;
}

function pageEmojis(pageIndex: number, pageCount: number): readonly string[] {
  const emojis: string[] = [];
  if (pageIndex > 0) emojis.push(TUT_PREVIOUS_PAGE_EMOJI);
  if (pageIndex < pageCount - 1) emojis.push(TUT_NEXT_PAGE_EMOJI);
  return emojis;
}

async function sendPaginatedEnemies(
  matches: readonly TutSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
  pageSize: number,
): Promise<void> {
  const pageCount = Math.ceil(matches.length / pageSize);
  let pageIndex = 0;
  const message = await output.send(
    formatEnemyPage(query, matches, pageIndex, pageSize, LIST_FOOTER, true),
  );
  for (const emoji of pageEmojis(pageIndex, pageCount)) await message.react(emoji);

  while (true) {
    const selectedEmoji = await message.waitForUserReaction(
      pageEmojis(pageIndex, pageCount),
      output.userId,
      timeoutMs,
    );
    if (!selectedEmoji) {
      await message.clearReactions();
      await message.edit(
        formatEnemyPage(
          query,
          matches,
          pageIndex,
          pageSize,
          "ページ操作受付は終了しました。詳細は o.tut <ID> で表示できます。",
          true,
        ),
      );
      return;
    }
    const nextPageIndex = selectedEmoji === TUT_PREVIOUS_PAGE_EMOJI
      ? pageIndex - 1
      : pageIndex + 1;
    if (nextPageIndex < 0 || nextPageIndex >= pageCount) continue;
    await message.clearReactions();
    pageIndex = nextPageIndex;
    await message.edit(
      formatEnemyPage(query, matches, pageIndex, pageSize, LIST_FOOTER, true),
    );
    for (const emoji of pageEmojis(pageIndex, pageCount)) await message.react(emoji);
  }
}

async function sendList(
  matches: readonly TutSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
  pageSize: number,
): Promise<void> {
  if (matches.length <= pageSize) {
    await output.send(
      formatEnemyPage(query, matches, 0, pageSize, LIST_FOOTER, false),
    );
    return;
  }
  await sendPaginatedEnemies(matches, query, output, timeoutMs, pageSize);
}

export function createTutCommand(dependencies: TutCommandDependencies): CommandDefinition {
  const timeoutMs = dependencies.reactionTimeoutMs ?? tutReactionTimeoutMs;
  const pageSize = dependencies.pageSize ?? tutPageSize;
  const helpSource = dependencies.helpSource ?? fileCommandHelpSource;
  const motionRenderer = dependencies.motionRenderer ?? sharedMotionRenderer;
  return {
    name: "tut",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const request = parseTutRequest(args);
      if (request.kind === "help") {
        await sendHelp(context, helpSource);
        return;
      }
      const output = context.interactive;
      if (!output) {
        await context.reply(DATA_ERROR_MESSAGE);
        return;
      }
      if (request.kind === "landing") {
        await output.send(tutSearchPageUrl);
        return;
      }
      if (request.kind === "invalid-motion") {
        await output.send(INVALID_MOTION_MESSAGE);
        return;
      }

      let data;
      try {
        data = await dependencies.dataSource.fetchSearchData();
      } catch (error) {
        console.error("Enemy data retrieval failed.", error);
        await output.send(DATA_ERROR_MESSAGE);
        return;
      }
      const matches = searchEnemies(data, request.query, request.force);
      if (matches.length === 0) {
        await output.send(NOT_FOUND_MESSAGE);
        return;
      }

      if (request.origin || request.motion) {
        let selected: TutSearchMatch | undefined;
        if (matches.length === 1) {
          selected = matches[0];
        } else if (matches.length <= TUT_NUMBER_EMOJIS.length) {
          selected = await selectEnemy(matches, request.query, output, timeoutMs);
        } else {
          await sendList(matches, request.query, output, timeoutMs, pageSize);
        }
        if (selected && request.origin) {
          await sendEnemyImage(selected, dependencies.dataSource, output);
        }
        if (selected && request.motion) {
          await sendEnemyMotion(selected, request.motion, dependencies.dataSource, motionRenderer, output);
        }
        return;
      }

      if (matches.length <= 3) {
        for (const match of matches) await output.send(formatEnemyDetail(match));
        return;
      }
      if (matches.length <= TUT_NUMBER_EMOJIS.length) {
        const selected = await selectEnemy(matches, request.query, output, timeoutMs);
        if (selected) await output.send(formatEnemyDetail(selected));
        return;
      }
      await sendList(matches, request.query, output, timeoutMs, pageSize);
    },
  };
}

export const tutCommand = createTutCommand({ dataSource: remoteTutDataSource });
