import {
  getModeMap,
  getSeriesId,
  getSeriesMemberIds,
  modeForGachaType,
  modeMatchesType,
} from "./domain";
import {
  GachaBlock,
  GachaEntry,
  GachaLookupData,
  GachaMode,
  GachaModeMaps,
  GachaScheduleData,
  ItemScheduleEntry,
} from "./types";

const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const FLAGS_MAP: Readonly<Record<number, string>> = {
  4: "【step up】",
  20600: "＋福引＆かけら",
  16384: "＋かけら",
  4216: "＋福引",
};
const GACHA_SCHEDULE_GIFT_TYPES = new Set([301, 302]);

export function parseHeaderDate(dateText: string, timeText: string): Date {
  const date = dateText.trim().padStart(8, "0");
  const time = timeText.trim().padStart(4, "0");
  return new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)) - 9,
      Number(time.slice(2, 4)),
    ),
  );
}

function formatJstParts(date: Date) {
  const jst = new Date(date.getTime() + JST_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    weekday: WEEKDAYS_JA[jst.getUTCDay()],
    hour: String(jst.getUTCHours()).padStart(2, "0"),
    minute: String(jst.getUTCMinutes()).padStart(2, "0"),
  };
}

export function formatJstFull(date: Date): string {
  const value = formatJstParts(date);
  return `${value.year}年${value.month}月${value.day}日(${value.weekday}) ${value.hour}:${value.minute}`;
}

export function formatJstShort(date: Date): string {
  const value = formatJstParts(date);
  return `${value.month}/${value.day}(${value.weekday}) ${value.hour}:${value.minute}`;
}

export function isPermanent(block: GachaBlock): boolean {
  return block.header.endDate === "20300101";
}

export function typeTag(gachaType: number): string {
  if (gachaType === 4) return " <イベント>";
  if (gachaType === 0) return " <ノーマル>";
  return "";
}

export function entryLabels(entry: GachaEntry): string {
  const labels: string[] = [];
  if (entry.guaranteed) labels.push("【確定】");
  const flag = FLAGS_MAP[entry.flags];
  if (flag) labels.push(flag);
  return labels.join("");
}

interface ScheduleSeries {
  mode: GachaMode;
  seriesId?: number;
  name: string;
  gachaEntries: Map<number, GachaEntry>;
  gachaTypes: Set<number>;
}

interface ScheduleGroup {
  active: boolean;
  period: string;
  series: Map<string, ScheduleSeries>;
  giftItems: Map<number, string>;
}

type ScheduleEvent =
  | {
      kind: "gacha";
      block: GachaBlock;
      start: Date;
      end: Date;
      startDateKey: string;
      endDateKey: string;
    }
  | {
      kind: "item";
      entry: ItemScheduleEntry;
      start: Date;
      end: Date;
      startDateKey: string;
      endDateKey: string;
    };

function scheduleSeriesKey(mode: GachaMode, seriesId: number | undefined, gachaId: number): string {
  return seriesId === undefined ? `${mode}:unknown:${gachaId}` : `${mode}:${seriesId}`;
}

export function formatSchedule(
  data: GachaScheduleData,
  now: Date,
  mode: GachaMode | null,
): string | undefined {
  const gachaEvents: readonly ScheduleEvent[] = data.gacha.data
    .filter((block) => {
      if (isPermanent(block) || !modeMatchesType(mode, block.header.gachaType)) return false;
      return parseHeaderDate(block.header.endDate, block.header.endTime) > now;
    })
    .map((block) => ({
      kind: "gacha" as const,
      block,
      start: parseHeaderDate(block.header.startDate, block.header.startTime),
      end: parseHeaderDate(block.header.endDate, block.header.endTime),
      startDateKey: block.header.startDate,
      endDateKey: block.header.endDate,
    }));

  const itemEvents: readonly ScheduleEvent[] =
    mode === "E" || mode === "N"
      ? []
      : data.item.data
          .filter((entry) => GACHA_SCHEDULE_GIFT_TYPES.has(entry.gift.giftType))
          .filter((entry) => {
            const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
            if (entry.header.endDate === "20300101") return start > now;
            return parseHeaderDate(entry.header.endDate, entry.header.endTime) > now;
          })
          .map((entry) => ({
            kind: "item" as const,
            entry,
            start: parseHeaderDate(entry.header.startDate, entry.header.startTime),
            end: parseHeaderDate(entry.header.endDate, entry.header.endTime),
            startDateKey: entry.header.startDate,
            endDateKey: entry.header.endDate,
          }));

  const events = [...gachaEvents, ...itemEvents].sort(
    (left, right) => left.start.getTime() - right.start.getTime(),
  );

  const groups = new Map<string, ScheduleGroup>();
  for (const event of events) {
    const { start, end } = event;
    const active = now >= start && now < end;
    const dateKey = (active ? event.endDateKey : event.startDateKey).trim().padStart(8, "0");
    const groupKey = `${active ? "active" : "upcoming"}:${dateKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        active,
        period: active ? `~${formatJstShort(end)}` : `${formatJstShort(start)}~`,
        series: new Map(),
        giftItems: new Map(),
      };
      groups.set(groupKey, group);
    }

    if (event.kind === "item") {
      const giftType = event.entry.gift.giftType;
      group.giftItems.set(giftType, data.saleNames.get(giftType) ?? "不明");
      continue;
    }

    const { block } = event;
    const blockMode = modeForGachaType(block.header.gachaType);
    for (const gacha of block.gachas) {
      if (gacha.id < 0) continue;
      const seriesId = getSeriesId(data.seriesMappings, block.header.gachaType, gacha.id);
      const key = scheduleSeriesKey(blockMode, seriesId, gacha.id);
      let series = group.series.get(key);
      if (!series) {
        const name =
          (seriesId === undefined
            ? undefined
            : data.shortSeriesNames[blockMode].get(seriesId)) ?? "不明";
        series = {
          mode: blockMode,
          ...(seriesId === undefined ? {} : { seriesId }),
          name,
          gachaEntries: new Map(),
          gachaTypes: new Set(),
        };
        group.series.set(key, series);
      }
      series.gachaEntries.set(gacha.id, gacha);
      series.gachaTypes.add(block.header.gachaType);
    }
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    lines.push(`${group.active ? "🟢" : "🟠"} [${group.period}]`);
    for (const [giftType, name] of [...group.giftItems].sort(([left], [right]) => left - right)) {
      lines.push(`    ${giftType} ${name}`);
    }
    for (const series of group.series.values()) {
      const seriesLabel = series.seriesId === undefined ? "s?" : `s${series.seriesId}`;
      const tag = series.gachaTypes.size === 1 ? typeTag([...series.gachaTypes][0]) : "";
      const entries = [...series.gachaEntries.values()].sort((left, right) => left.id - right.id);
      for (const entry of entries) {
        lines.push(`    ${entry.id} ${seriesLabel} ${series.name}${entryLabels(entry)}${tag}`);
      }
    }
  }
  if (lines.length === 0) return undefined;
  return `ガチャスケジュール [開催中＆予定]\n\n${lines.join("\n")}`;
}

function formatRates(entry: GachaEntry): string {
  const values: readonly (readonly [string, number])[] = [
    ["ノーマル", entry.rates.normal],
    ["レア", entry.rates.rare],
    ["超激レア", entry.rates.uberRare],
    ["伝説レア", entry.rates.legendRare],
  ];
  return values
    .filter(([, value]) => value !== 0)
    .map(([label, value]) => `${label} ${value}`)
    .join(", ");
}

export function formatGachaDetail(
  block: GachaBlock,
  entry: GachaEntry,
  data: GachaLookupData,
): string {
  const start = parseHeaderDate(block.header.startDate, block.header.startTime);
  const end = isPermanent(block)
    ? "常設"
    : formatJstFull(parseHeaderDate(block.header.endDate, block.header.endTime));
  const mode = modeForGachaType(block.header.gachaType);
  const name = data.gachaNames[mode].get(entry.id) ?? "不明";
  const seriesId = getSeriesId(data.seriesMappings, block.header.gachaType, entry.id);
  const seriesLabel = seriesId === undefined ? "s?" : `s${seriesId}`;
  const lines = [
    `${formatJstFull(start)} ～ ${end}  ver.${block.header.minVersion}～${block.header.maxVersion}`,
    `${entry.id} ${seriesLabel} ${name}${entryLabels(entry)}${typeTag(block.header.gachaType)}`,
  ];
  const rates = formatRates(entry);
  if (rates) lines.push(`レート: ${rates}`);
  if (entry.message) lines.push(`メッセージ: ${entry.message}`);
  return lines.join("\n");
}

export interface SeriesSummary {
  mode: GachaMode;
  seriesId: number;
  name: string;
  gachaIds: readonly number[];
}

export function findSeriesSummaries(
  seriesId: number,
  mode: GachaMode | null,
  names: GachaModeMaps<ReadonlyMap<number, string>>,
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
): readonly SeriesSummary[] {
  const modes: readonly GachaMode[] = mode ? [mode] : ["R", "E", "N"];
  return modes.flatMap((candidateMode) => {
    const gachaIds = getSeriesMemberIds(mappings[candidateMode], seriesId);
    if (gachaIds.length === 0) return [];
    return [{
      mode: candidateMode,
      seriesId,
      name: names[candidateMode].get(seriesId) ?? "不明",
      gachaIds,
    }];
  });
}

export function searchSeriesSummaries(
  query: string,
  mode: GachaMode | null,
  names: GachaModeMaps<ReadonlyMap<number, string>>,
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
): readonly SeriesSummary[] {
  const normalized = query.toLowerCase();
  const modes: readonly GachaMode[] = mode ? [mode] : ["R", "E", "N"];
  return modes.flatMap((candidateMode) =>
    [...names[candidateMode]]
      .filter(([, name]) => name.toLowerCase().includes(normalized))
      .sort(([left], [right]) => left - right)
      .map(([seriesId, name]) => ({
        mode: candidateMode,
        seriesId,
        name,
        gachaIds: getSeriesMemberIds(mappings[candidateMode], seriesId),
      }))
      .filter((summary) => summary.gachaIds.length > 0),
  );
}

export function formatSeriesSummaries(summaries: readonly SeriesSummary[]): string {
  return summaries
    .map((summary) => {
      const gachaType = summary.mode === "R" ? 1 : summary.mode === "E" ? 4 : 0;
      return summary.gachaIds
        .map((gachaId) => `${gachaId} s${summary.seriesId} ${summary.name}${typeTag(gachaType)}`)
        .join("\n");
    })
    .join("\n\n");
}

export function blockMatchesSeries(
  block: GachaBlock,
  seriesId: number,
  mappings: GachaModeMaps<ReadonlyMap<number, number>>,
): boolean {
  const mapping = getModeMap(mappings, block.header.gachaType);
  return block.gachas.some((entry) => mapping.get(entry.id) === seriesId);
}
