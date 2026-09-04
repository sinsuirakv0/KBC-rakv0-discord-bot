import {
  blockMatchesSeries,
  findSeriesSummaries,
  formatGachaDetail,
  formatSchedule,
  formatSeriesSummaries,
  searchSeriesSummaries,
} from "./formatters";
import { mergeSeriesNames, modeMatchesType, parseGatyaRequest } from "./domain";
import { remoteGatyaDataSource } from "./data-source";
import { sendChunked } from "../shared/messaging";
import {
  CommandContext,
  CommandDefinition,
  InteractiveCommandOutput,
} from "../types";
import {
  GachaBlock,
  GachaJson,
  GachaModeMaps,
  GachaTarget,
  GatyaDataSource,
  GatyaRequest,
} from "./types";

export interface GatyaCommandDependencies {
  dataSource: GatyaDataSource;
  now(): Date;
}

async function loadData<T>(
  output: InteractiveCommandOutput,
  load: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    console.error("Gatya data retrieval failed.", error);
    await output.send("❌ データ取得に失敗しました");
    return undefined;
  }
}

function findGachaBlocks(
  gacha: GachaJson,
  id: number,
  mode: GatyaRequest["mode"],
): readonly GachaBlock[] {
  return gacha.data.filter(
    (block) =>
      modeMatchesType(mode, block.header.gachaType) &&
      block.gachas.some((entry) => entry.id === id),
  );
}

function findSeriesBlocks(
  gacha: GachaJson,
  seriesId: number,
  mode: GatyaRequest["mode"],
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
): readonly GachaBlock[] {
  return gacha.data.filter(
    (block) =>
      modeMatchesType(mode, block.header.gachaType) &&
      blockMatchesSeries(block, seriesId, mappings),
  );
}

function targetError(target: GachaTarget): string {
  return target.kind === "gacha"
    ? `❌ ID \`${target.id}\` はガチャjsonに含まれていません`
    : `❌ seriesID \`s${target.id}\` はガチャデータに含まれていません`;
}

async function handleSchedule(
  request: Extract<GatyaRequest, { kind: "schedule" }>,
  dependencies: GatyaCommandDependencies,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dependencies.dataSource.fetchScheduleData());
  if (!data) return;
  const schedule = formatSchedule(data, dependencies.now(), request.mode);
  if (!schedule) {
    await output.send("開催中・近日予定のガチャはありません");
    return;
  }
  await sendChunked(output, schedule);
}

async function handleDetail(
  request: Extract<GatyaRequest, { kind: "detail" }>,
  dataSource: GatyaDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchLookupData());
  if (!data) return;
  if (request.target.kind === "series") {
    const names = mergeSeriesNames(data.seriesNames, data.shortSeriesNames);
    const summaries = findSeriesSummaries(
      request.target.id,
      request.mode,
      names,
      data.seriesMappings,
    );
    if (summaries.length === 0) {
      await output.send(targetError(request.target));
      return;
    }
    await sendChunked(output, formatSeriesSummaries(summaries));
    return;
  }

  const blocks = findGachaBlocks(data.gacha, request.target.id, request.mode);
  if (blocks.length === 0) {
    await output.send(targetError(request.target));
    return;
  }
  for (const block of blocks) {
    const entry = block.gachas.find((candidate) => candidate.id === request.target.id);
    if (entry) await sendChunked(output, formatGachaDetail(block, entry, data));
  }
}

async function handleSearch(
  request: Extract<GatyaRequest, { kind: "search" }>,
  dataSource: GatyaDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  const data = await loadData(output, () => dataSource.fetchLookupData());
  if (!data) return;
  const names = mergeSeriesNames(data.seriesNames, data.shortSeriesNames);
  const summaries = searchSeriesSummaries(
    request.query,
    request.mode,
    names,
    data.seriesMappings,
  );
  if (summaries.length === 0) {
    await output.send(`❌ スケジュール内に \`${request.query}\` は見つかりませんでした`);
    return;
  }
  await sendChunked(output, formatSeriesSummaries(summaries));
}

async function handleJsonOrRaw(
  request: Extract<GatyaRequest, { kind: "json" | "raw" }>,
  dataSource: GatyaDataSource,
  output: InteractiveCommandOutput,
): Promise<void> {
  let blocks: readonly GachaBlock[];
  if (request.target.kind === "series") {
    const data = await loadData(output, () => dataSource.fetchJsonWithMappings());
    if (!data) return;
    blocks = findSeriesBlocks(
      data.gacha,
      request.target.id,
      request.mode,
      data.seriesMappings,
    );
  } else {
    const gacha = await loadData(output, () => dataSource.fetchGachaJson());
    if (!gacha) return;
    blocks = findGachaBlocks(gacha, request.target.id, request.mode);
  }

  if (blocks.length === 0) {
    await output.send(targetError(request.target));
    return;
  }
  for (const block of blocks) {
    if (request.kind === "raw") {
      if (!block.raw) {
        await output.send(`❌ (startDate: ${block.header.startDate}) に raw データがありません`);
      } else {
        await sendChunked(output, block.raw.replace(/\t/g, "    "));
      }
    } else {
      const { raw: _raw, ...withoutRaw } = block;
      await sendChunked(output, JSON.stringify(withoutRaw, null, 2), "json");
    }
  }
}

export function createGatyaCommand(
  dependencies: GatyaCommandDependencies,
): CommandDefinition {
  return {
    name: "gatya",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const output = context.interactive;
      if (!output) {
        await context.reply("❌ gatyaコマンドの実行環境を初期化できませんでした");
        return;
      }
      const request = parseGatyaRequest(args);
      if (request.kind === "schedule") {
        await handleSchedule(request, dependencies, output);
      } else if (request.kind === "detail") {
        await handleDetail(request, dependencies.dataSource, output);
      } else if (request.kind === "search") {
        await handleSearch(request, dependencies.dataSource, output);
      } else {
        await handleJsonOrRaw(request, dependencies.dataSource, output);
      }
    },
  };
}

export const gatyaCommand = createGatyaCommand({
  dataSource: remoteGatyaDataSource,
  now: () => new Date(),
});
