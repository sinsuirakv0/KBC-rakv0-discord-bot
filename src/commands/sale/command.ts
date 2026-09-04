import { CommandContext, CommandDefinition, InteractiveCommandOutput } from "../types";
import {
  findNameMatches,
  getStageName,
  parseSaleRequest,
  StageNameSources,
} from "./domain";
import { remoteSaleDataSource } from "./data-source";
import { formatEntryDetail, formatSchedule } from "./formatters";
import { sendChunked } from "./messaging";
import { SaleDataSource, SaleDisplayData, SaleJson, SaleRequest } from "./types";

const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const REACTION_WAIT_MS = 30_000;

export interface SaleCommandDependencies {
  dataSource: SaleDataSource;
  now(): Date;
}

async function loadData<T>(
  output: InteractiveCommandOutput,
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    console.error("Sale data retrieval failed.", error);
    await output.send("❌ データ取得に失敗しました");
    return undefined;
  }
}

async function sendDetails(
  id: number,
  data: SaleDisplayData,
  output: InteractiveCommandOutput,
): Promise<void> {
  const entries = data.sale.data.filter((entry) => entry.stageIds.includes(id));
  if (entries.length === 0) {
    const content = `❌ ID \`${id}\` は sale.json に含まれていません`;
    await output.send(content);
    return;
  }
  const nameSources: StageNameSources = data;
  for (const entry of entries) {
    await sendChunked(
      output,
      formatEntryDetail(entry, nameSources, data.cardSettingStageIds, id),
    );
  }
}

async function handleSchedule(
  dataSource: SaleDataSource,
  output: InteractiveCommandOutput,
  now: Date,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchDisplayData());
  if (!data) return;
  const schedule = formatSchedule(data, now);
  if (!schedule) {
    await output.send("開催中・予定のセールイベントはありません");
    return;
  }
  await sendChunked(output, schedule);
}

async function handleDetail(
  id: number,
  dataSource: SaleDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchDisplayData());
  if (!data) return;
  await sendDetails(id, data, output);
}

async function handleJsonOrRaw(
  request: Extract<SaleRequest, { kind: "json" | "raw" }>,
  dataSource: SaleDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const sale = await loadData(output, () => dataSource.fetchSaleJson());
  if (!sale) return;
  const entries = sale.data.filter((entry) => entry.stageIds.includes(request.id));
  if (entries.length === 0) {
    await output.send(
      `❌ ID \`${request.id}\` は sale.json に含まれていません`,
    );
    return;
  }
  for (const entry of entries) {
    if (request.kind === "raw") {
      if (!entry.raw) {
        await output.send(
          `❌ (startDate: \`${entry.header.startDate}\`) に raw データがありません`,
        );
      } else {
        await sendChunked(output, entry.raw.replace(/\t/g, "    "));
      }
    } else {
      const { raw: _raw, ...entryWithoutRaw } = entry;
      await sendChunked(output, JSON.stringify(entryWithoutRaw, null, 2), "json");
    }
  }
}

async function handleSearch(
  query: string,
  dataSource: SaleDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchDisplayData());
  if (!data) return;
  const matches = findNameMatches(query, data.saleNames, data.allDayEventNames);
  if (matches.length === 0) {
    await output.send(
      `❌ \`${query}\` に一致するイベントは見つかりませんでした`,
    );
    return;
  }

  if (matches.length <= NUMBER_EMOJIS.length) {
    const lines = matches.map(
      ([id, name], index) => `${NUMBER_EMOJIS[index]} ${id} ${name}`,
    );
    const resultMessage = await output.send(`\`\`\`\n${lines.join("\n")}\n\`\`\``);
    for (let index = 0; index < matches.length; index += 1) {
      await resultMessage.react(NUMBER_EMOJIS[index]);
    }
    const selectedEmoji = await resultMessage.waitForUserReaction(
      NUMBER_EMOJIS.slice(0, matches.length),
      output.userId,
      REACTION_WAIT_MS,
    );
    if (!selectedEmoji) return;
    const selectedIndex = NUMBER_EMOJIS.indexOf(selectedEmoji);
    const selected = matches[selectedIndex];
    if (selected) await sendDetails(selected[0], data, output);
    return;
  }

  const lines = matches.map(([id, name]) => `${id} ${name}`);
  await sendChunked(
    output,
    `「${query}」の検索結果 (${matches.length}件)\n\n${lines.join("\n")}`,
  );
}

export function createSaleCommand(
  dependencies: SaleCommandDependencies,
): CommandDefinition {
  return {
    name: "sale",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const output = context.interactive;
      if (!output) {
        await context.reply("❌ saleコマンドの実行環境を初期化できませんでした");
        return;
      }
      const request = parseSaleRequest(args);
      if (request.kind === "schedule") {
        await handleSchedule(dependencies.dataSource, output, dependencies.now());
      } else if (request.kind === "detail") {
        await handleDetail(request.id, dependencies.dataSource, output);
      } else if (request.kind === "json" || request.kind === "raw") {
        await handleJsonOrRaw(request, dependencies.dataSource, output);
      } else {
        await handleSearch(request.query, dependencies.dataSource, output);
      }
    },
  };
}

export const saleCommand = createSaleCommand({
  dataSource: remoteSaleDataSource,
  now: () => new Date(),
});
