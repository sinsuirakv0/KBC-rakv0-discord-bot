import {
  utPageSize,
  utReactionTimeoutMs,
  utSearchPageUrl,
} from "../../config/ut";
import { CommandContext, CommandDefinition, InteractiveCommandOutput } from "../types";
import { remoteUtDataSource } from "./data-source";
import { resolveOriginAssetPath, searchCharacterIndex } from "./domain";
import {
  formatDetailResult,
  formatMatchLabel,
  formatResultPage,
  formatSelectionList,
  NEXT_PAGE_EMOJI,
  NUMBER_EMOJIS,
  PREVIOUS_PAGE_EMOJI,
} from "./formatters";
import { parseUtRequest } from "./parsers";
import { UtDataSource, UtOriginRequest, UtSearchMatch } from "./types";

const NOT_FOUND_MESSAGE = "該当する味方キャラが見つかりませんでした。";
const INVALID_ORIGIN_MESSAGE =
  "originの指定が正しくありません。o.ut help で使い方を確認してください。";
const MISSING_IMAGE_MESSAGE = "指定した画像はこのキャラには存在しません。";
const DATA_ERROR_MESSAGE =
  "味方キャラデータの取得に失敗しました。しばらくしてからもう一度お試しください。";
const LIST_FOOTER = "詳細は o.ut <ID> で表示できます。";

export interface UtCommandDependencies {
  dataSource: UtDataSource;
  reactionTimeoutMs?: number;
  pageSize?: number;
}

async function loadData<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    console.error("Ut data retrieval failed.", error);
    return undefined;
  }
}

async function sendOriginImage(
  match: UtSearchMatch,
  origin: UtOriginRequest,
  dataSource: UtDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const assets = await loadData(() => dataSource.fetchCharacterAssets());
  if (!assets) {
    await output.send(DATA_ERROR_MESSAGE);
    return;
  }
  const relativePath = resolveOriginAssetPath(assets, match.unit.id, origin);
  if (!relativePath) {
    await output.send(MISSING_IMAGE_MESSAGE);
    return;
  }
  const attachment = await loadData(() => dataSource.fetchPng(relativePath));
  if (!attachment) {
    await output.send(DATA_ERROR_MESSAGE);
    return;
  }
  await output.sendAttachment(attachment);
}

async function selectMatch(
  matches: readonly UtSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
): Promise<UtSearchMatch | undefined> {
  const prompt = "数字のリアクションで選択してください。";
  const message = await output.send(formatSelectionList(query, matches, prompt));
  const emojis = NUMBER_EMOJIS.slice(0, matches.length);
  for (const emoji of emojis) await message.react(emoji);

  const selectedEmoji = await message.waitForUserReaction(
    emojis,
    output.userId,
    timeoutMs,
  );
  if (!selectedEmoji) {
    await message.clearReactions();
    await message.edit(
      formatSelectionList(query, matches, "選択受付は終了しました。"),
    );
    return undefined;
  }

  const match = matches[NUMBER_EMOJIS.indexOf(selectedEmoji as typeof NUMBER_EMOJIS[number])];
  if (!match) return undefined;
  await message.clearReactions();
  await message.edit(
    formatSelectionList(query, matches, `選択済み: ${formatMatchLabel(match)}`),
  );
  return match;
}

function pageEmojis(pageIndex: number, pageCount: number): readonly string[] {
  const emojis: string[] = [];
  if (pageIndex > 0) emojis.push(PREVIOUS_PAGE_EMOJI);
  if (pageIndex < pageCount - 1) emojis.push(NEXT_PAGE_EMOJI);
  return emojis;
}

async function sendPaginatedResults(
  matches: readonly UtSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
  pageSize: number,
): Promise<void> {
  const pageCount = Math.ceil(matches.length / pageSize);
  let pageIndex = 0;
  const activeFooter = LIST_FOOTER;
  const message = await output.send(
    formatResultPage(query, matches, pageIndex, pageSize, activeFooter, true),
  );
  for (const emoji of pageEmojis(pageIndex, pageCount)) await message.react(emoji);

  while (true) {
    const validEmojis = pageEmojis(pageIndex, pageCount);
    const selectedEmoji = await message.waitForUserReaction(
      validEmojis,
      output.userId,
      timeoutMs,
    );
    if (!selectedEmoji) {
      await message.clearReactions();
      await message.edit(
        formatResultPage(
          query,
          matches,
          pageIndex,
          pageSize,
          "ページ操作受付は終了しました。詳細は o.ut <ID> で表示できます。",
          true,
        ),
      );
      return;
    }

    const nextPageIndex =
      selectedEmoji === PREVIOUS_PAGE_EMOJI ? pageIndex - 1 : pageIndex + 1;
    if (nextPageIndex < 0 || nextPageIndex >= pageCount) continue;

    await message.clearReactions();
    pageIndex = nextPageIndex;
    await message.edit(
      formatResultPage(query, matches, pageIndex, pageSize, activeFooter, true),
    );
    for (const emoji of pageEmojis(pageIndex, pageCount)) await message.react(emoji);
  }
}

async function sendListResults(
  matches: readonly UtSearchMatch[],
  query: string,
  output: InteractiveCommandOutput,
  timeoutMs: number,
  pageSize: number,
): Promise<void> {
  if (matches.length <= pageSize) {
    await output.send(formatResultPage(query, matches, 0, pageSize, LIST_FOOTER, false));
    return;
  }
  await sendPaginatedResults(matches, query, output, timeoutMs, pageSize);
}

export function createUtCommand(dependencies: UtCommandDependencies): CommandDefinition {
  const timeoutMs = dependencies.reactionTimeoutMs ?? utReactionTimeoutMs;
  const pageSize = dependencies.pageSize ?? utPageSize;
  return {
    name: "ut",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const output = context.interactive;
      if (!output) {
        await context.reply(DATA_ERROR_MESSAGE);
        return;
      }

      const request = parseUtRequest(args);
      if (request.kind === "landing") {
        await output.send(utSearchPageUrl);
        return;
      }
      if (request.kind === "invalid-origin") {
        await output.send(INVALID_ORIGIN_MESSAGE);
        return;
      }

      const index = await loadData(() => dependencies.dataSource.fetchCharacterIndex());
      if (!index) {
        await output.send(DATA_ERROR_MESSAGE);
        return;
      }
      const matches = searchCharacterIndex(index, request.query, request.force);
      if (matches.length === 0) {
        await output.send(NOT_FOUND_MESSAGE);
        return;
      }

      if (request.origin) {
        if (matches.length === 1) {
          await sendOriginImage(matches[0], request.origin, dependencies.dataSource, output);
          return;
        }
        if (matches.length <= NUMBER_EMOJIS.length) {
          const selected = await selectMatch(matches, request.query, output, timeoutMs);
          if (selected) {
            await sendOriginImage(selected, request.origin, dependencies.dataSource, output);
          }
          return;
        }
        await sendListResults(matches, request.query, output, timeoutMs, pageSize);
        return;
      }

      if (matches.length <= 3) {
        for (const match of matches) await output.send(formatDetailResult(match));
        return;
      }
      if (matches.length <= NUMBER_EMOJIS.length) {
        const selected = await selectMatch(matches, request.query, output, timeoutMs);
        if (selected) await output.send(formatDetailResult(selected));
        return;
      }
      await sendListResults(matches, request.query, output, timeoutMs, pageSize);
    },
  };
}

export const utCommand = createUtCommand({ dataSource: remoteUtDataSource });
