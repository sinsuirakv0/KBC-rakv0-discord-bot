import { sendChunked } from "../shared/messaging";
import {
  CommandContext,
  CommandDefinition,
  InteractiveCommandOutput,
} from "../types";
import { remoteItemDataSource } from "./data-source";
import { parseItemRequest, searchItemEntries } from "./domain";
import { formatItemDetail, formatItemSchedule } from "./formatters";
import { ItemDataSource, ItemRequest } from "./types";

const USAGE =
  "❌ 使い方:\n　`o.item` — アイテム配布一覧\n　`o.item <ID>` — giftType/eventIDで検索\n　`o.item <ID> j` — JSON表示\n　`o.item <ID> r` — Raw表示";

export interface ItemCommandDependencies {
  dataSource: ItemDataSource;
  now(): Date;
}

async function loadData<T>(
  output: InteractiveCommandOutput,
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    console.error("Item data retrieval failed.", error);
    await output.send("❌ データ取得に失敗しました");
    return undefined;
  }
}

function notFoundMessage(id: number): string {
  return `❌ \`${id}\` は giftType・eventID のどちらでも見つかりませんでした`;
}

async function notifyEventIdSearch(
  output: InteractiveCommandOutput,
  id: number,
): Promise<void> {
  await output.send(
    `ℹ️ giftType \`${id}\` では見つからなかった為、eventID で検索しました`,
  );
}

async function handleSchedule(
  dependencies: ItemCommandDependencies,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dependencies.dataSource.fetchDisplayData());
  if (!data) return;
  const schedule = formatItemSchedule(data, dependencies.now());
  if (!schedule) {
    await output.send("開催中・予定のアイテム配布はありません");
    return;
  }
  await sendChunked(output, schedule);
}

async function handleDetail(
  request: Extract<ItemRequest, { kind: "detail" }>,
  dataSource: ItemDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchDisplayData());
  if (!data) return;
  const result = searchItemEntries(request.id, data.item);
  if (result.entries.length === 0) {
    await output.send(notFoundMessage(request.id));
    return;
  }
  if (result.searchedByEventId) await notifyEventIdSearch(output, request.id);
  for (const entry of result.entries) {
    await sendChunked(output, formatItemDetail(entry, data));
  }
}

async function handleJsonOrRaw(
  request: Extract<ItemRequest, { kind: "json" | "raw" }>,
  dataSource: ItemDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const item = await loadData(output, () => dataSource.fetchItemJson());
  if (!item) return;
  const result = searchItemEntries(request.id, item);
  if (result.entries.length === 0) {
    await output.send(notFoundMessage(request.id));
    return;
  }
  if (result.searchedByEventId) await notifyEventIdSearch(output, request.id);
  for (const entry of result.entries) {
    if (request.kind === "raw") {
      if (!entry.raw) {
        await output.send(
          `❌ (startDate: \`${entry.header.startDate}\`) に raw データがありません`,
        );
      } else {
        await sendChunked(output, entry.raw.replace(/\t/g, "    "));
      }
    } else {
      const { raw: _raw, ...withoutRaw } = entry;
      await sendChunked(output, JSON.stringify(withoutRaw, null, 2), "json");
    }
  }
}

export function createItemCommand(
  dependencies: ItemCommandDependencies,
): CommandDefinition {
  return {
    name: "item",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const output = context.interactive;
      if (!output) {
        await context.reply("❌ itemコマンドの実行環境を初期化できませんでした");
        return;
      }
      const request = parseItemRequest(args);
      if (request.kind === "schedule") {
        await handleSchedule(dependencies, output);
      } else if (request.kind === "detail") {
        await handleDetail(request, dependencies.dataSource, output);
      } else if (request.kind === "json" || request.kind === "raw") {
        await handleJsonOrRaw(request, dependencies.dataSource, output);
      } else {
        await output.send(USAGE);
      }
    },
  };
}

export const itemCommand = createItemCommand({
  dataSource: remoteItemDataSource,
  now: () => new Date(),
});
