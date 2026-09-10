import { GachaScheduleData } from "../../commands/gatya/types";
import { getSeriesId, modeForGachaType } from "../../commands/gatya/domain";
import { entryLabels, typeTag, formatJstShort, parseHeaderDate } from "../../commands/gatya/formatters";
import { SaleDisplayData } from "../../commands/sale/types";
import { getListStageIds, getStageName, isMissionId } from "../../commands/sale/domain";
import { formatDuration } from "../../commands/sale/formatters";
import { ItemDisplayData } from "../../commands/item/types";
import { getItemScheduleName } from "../../commands/item/domain";
import { skdDisplayLimit } from "../../config/skd";

interface Header { startDate: string; startTime: string; endDate: string; endTime: string; }
interface Row { header: Header; label: string; }
export interface AddedScheduleData { gatya?: GachaScheduleData; sale?: SaleDisplayData; item?: ItemDisplayData; }

function formatSection(name: string, rows: Row[], now: Date): string {
  const unique = new Map(rows.map(row => [JSON.stringify([row.header.startDate, row.header.startTime, row.header.endDate, row.header.endTime, row.label]), row]));
  const visible = [...unique.values()].filter(row => row.header.endDate !== "20300101"
    && parseHeaderDate(row.header.endDate, row.header.endTime) > now)
    .sort((a, b) => parseHeaderDate(a.header.startDate, a.header.startTime).getTime() - parseHeaderDate(b.header.startDate, b.header.startTime).getTime());
  const groups = new Map<string, { title: string; labels: string[] }>();
  for (const row of visible.slice(0, skdDisplayLimit)) {
    const start = parseHeaderDate(row.header.startDate, row.header.startTime);
    const active = start <= now;
    const date = active ? parseHeaderDate(row.header.endDate, row.header.endTime) : start;
    const key = `${active}:${active ? row.header.endDate : row.header.startDate}`;
    const group = groups.get(key) ?? { title: active ? `🟢 [~${formatJstShort(date)}]` : `🟠 [${formatJstShort(date)}~]`, labels: [] };
    group.labels.push(`    ${row.label.replace(/[`\r\n]/g, " ").slice(0, 240)}`);
    groups.set(key, group);
  }
  const lines = [...groups.values()].flatMap(group => [group.title, ...group.labels]);
  if (!lines.length) lines.push("追加なし");
  if (visible.length > skdDisplayLimit) lines.push(`その他${visible.length - skdDisplayLimit}件`);
  return `**${name}**\n\`\`\`text\n${lines.join("\n")}\n\`\`\``;
}

export function formatAddedSchedules(data: AddedScheduleData, now: Date, historyUrl: string): string[] {
  const rows: Record<"gatya" | "sale" | "item" | "mission", Row[]> = { gatya: [], sale: [], item: [], mission: [] };
  if (data.gatya) for (const block of data.gatya.gacha.data) {
    const mode = modeForGachaType(block.header.gachaType);
    for (const entry of block.gachas) {
      if (entry.id < 0) continue;
      const seriesId = getSeriesId(data.gatya.seriesMappings, block.header.gachaType, entry.id);
      const name = seriesId === undefined ? "不明" : data.gatya.shortSeriesNames[mode].get(seriesId) ?? "不明";
      rows.gatya.push({ header: block.header, label: `${entry.id} s${seriesId ?? "?"} ${name}${entryLabels(entry)}${typeTag(block.header.gachaType)}` });
    }
  }
  if (data.sale) for (const entry of data.sale.sale.data) {
    const duration = formatDuration(parseHeaderDate(entry.header.startDate, entry.header.startTime), parseHeaderDate(entry.header.endDate, entry.header.endTime));
    for (const id of getListStageIds(entry, data.sale.cardSettingStageIds)) rows.sale.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale)} ${duration}` });
    for (const id of entry.stageIds.filter(isMissionId)) rows.mission.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale)} ${duration}` });
  }
  if (data.item) for (const entry of data.item.item.data) {
    rows.item.push({ header: entry.header, label: `${entry.gift.giftType} ${getItemScheduleName(entry, data.item)}${entry.gift.giftAmount > 0 ? ` ×${entry.gift.giftAmount}` : ""}` });
  }
  return [...(["gatya", "sale", "item", "mission"] as const).map(type => formatSection(type, rows[type], now)), `**KBC**\n<${historyUrl}>`];
}
