import {
  stPageSize,
  stReactionTimeoutMs,
  stSearchPageUrl,
} from "../../config/st";
import { fileCommandHelpSource } from "../help/data-source";
import { CommandHelpSource } from "../help/types";
import { CommandContext, CommandDefinition, InteractiveCommandOutput } from "../types";
import { remoteStDataSource } from "./data-source";
import { searchStages } from "./domain";
import {
  formatStageDetail,
  formatStageLabel,
  formatStagePage,
  formatStageSelection,
  ST_NEXT_PAGE_EMOJI,
  ST_NUMBER_EMOJIS,
  ST_PREVIOUS_PAGE_EMOJI,
} from "./formatters";
import { parseStRequest } from "./parsers";
import { StageSearchEntry, StDataSource } from "./types";

const NOT_FOUND_MESSAGE = "該当するステージが見つかりませんでした。";
const DATA_ERROR_MESSAGE =
  "ステージデータを取得できませんでした。時間をおいて再度お試しください。";
const LIST_FOOTER = "詳細は o.st <ID> で表示できます。";

export interface StCommandDependencies {
  dataSource: StDataSource;
  helpSource?: CommandHelpSource;
  reactionTimeoutMs?: number;
  pageSize?: number;
}

async function selectStage(
  matches: readonly StageSearchEntry[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
): Promise<StageSearchEntry | undefined> {
  const message = await output.send(
    formatStageSelection(query, matches, "数字のリアクションで選択してください。"),
  );
  const emojis = ST_NUMBER_EMOJIS.slice(0, matches.length);
  for (const emoji of emojis) await message.react(emoji);
  const selectedEmoji = await message.waitForUserReaction(
    emojis,
    output.userId,
    timeoutMs,
  );
  if (!selectedEmoji) {
    await message.clearReactions();
    await message.edit(
      formatStageSelection(query, matches, "選択受付は終了しました。"),
    );
    return undefined;
  }
  const selectedIndex = ST_NUMBER_EMOJIS.indexOf(
    selectedEmoji as typeof ST_NUMBER_EMOJIS[number],
  );
  const selected = matches[selectedIndex];
  if (!selected) return undefined;
  await message.clearReactions();
  await message.edit(
    formatStageSelection(
      query,
      matches,
      `選択済み: ${formatStageLabel(selected)}`,
    ),
  );
  return selected;
}

function pageEmojis(pageIndex: number, pageCount: number): readonly string[] {
  const emojis: string[] = [];
  if (pageIndex > 0) emojis.push(ST_PREVIOUS_PAGE_EMOJI);
  if (pageIndex < pageCount - 1) emojis.push(ST_NEXT_PAGE_EMOJI);
  return emojis;
}

async function sendPaginatedStages(
  matches: readonly StageSearchEntry[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
  pageSize: number,
): Promise<void> {
  const pageCount = Math.ceil(matches.length / pageSize);
  let pageIndex = 0;
  const message = await output.send(
    formatStagePage(query, matches, pageIndex, pageSize, LIST_FOOTER, true),
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
        formatStagePage(
          query,
          matches,
          pageIndex,
          pageSize,
          "ページ操作受付は終了しました。詳細は o.st <ID> で表示できます。",
          true,
        ),
      );
      return;
    }
    const nextPageIndex = selectedEmoji === ST_PREVIOUS_PAGE_EMOJI
      ? pageIndex - 1
      : pageIndex + 1;
    if (nextPageIndex < 0 || nextPageIndex >= pageCount) continue;
    await message.clearReactions();
    pageIndex = nextPageIndex;
    await message.edit(
      formatStagePage(query, matches, pageIndex, pageSize, LIST_FOOTER, true),
    );
    for (const emoji of pageEmojis(pageIndex, pageCount)) await message.react(emoji);
  }
}

async function sendHelp(
  context: CommandContext,
  helpSource: CommandHelpSource,
): Promise<void> {
  try {
    await context.reply(await helpSource.read("st"));
  } catch (error) {
    console.error("Command help retrieval failed: st", error);
    await context.reply("ヘルプの読み込みに失敗しました。");
  }
}

export function createStCommand(dependencies: StCommandDependencies): CommandDefinition {
  const timeoutMs = dependencies.reactionTimeoutMs ?? stReactionTimeoutMs;
  const pageSize = dependencies.pageSize ?? stPageSize;
  const helpSource = dependencies.helpSource ?? fileCommandHelpSource;
  return {
    name: "st",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const request = parseStRequest(args);
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
        await output.send(stSearchPageUrl);
        return;
      }
      let data;
      try {
        data = await dependencies.dataSource.fetchSearchData();
      } catch (error) {
        console.error("Stage data retrieval failed.", error);
        await output.send(DATA_ERROR_MESSAGE);
        return;
      }
      const matches = searchStages(data, request.query, request.force);
      if (matches.length === 0) {
        await output.send(NOT_FOUND_MESSAGE);
        return;
      }
      if (matches.length <= 3) {
        for (const match of matches) await output.send(formatStageDetail(match));
        return;
      }
      if (matches.length <= ST_NUMBER_EMOJIS.length) {
        const selected = await selectStage(matches, request.query, output, timeoutMs);
        if (selected) await output.send(formatStageDetail(selected));
        return;
      }
      if (matches.length <= pageSize) {
        await output.send(
          formatStagePage(request.query, matches, 0, pageSize, LIST_FOOTER, false),
        );
        return;
      }
      await sendPaginatedStages(matches, request.query, output, timeoutMs, pageSize);
    },
  };
}

export const stCommand = createStCommand({ dataSource: remoteStDataSource });
