import { GachaEntry, GachaScheduleData } from "../../commands/gatya/types";
import { getSeriesId, modeForGachaType } from "../../commands/gatya/domain";
import { entryLabels, typeTag, formatJstShort, parseHeaderDate } from "../../commands/gatya/formatters";
import { SaleDisplayData, SaleHeader } from "../../commands/sale/types";
import { getListStageIds, getStageName, isMissionId } from "../../commands/sale/domain";
import { formatDuration } from "../../commands/sale/formatters";
import { ItemDisplayData, ItemEntry } from "../../commands/item/types";
import { getItemScheduleName } from "../../commands/item/domain";
import { skdDisplayLimit } from "../../config/skd";
import { ScheduleChanges } from "./diff";

interface Header { startDate: string; startTime: string; endDate: string; endTime: string; }
interface Row { header: Header; label: string; }
export interface AddedScheduleData { gatya?: GachaScheduleData; sale?: SaleDisplayData; item?: ItemDisplayData; changes?: ScheduleChanges; }

function gachaLabel(entry: GachaEntry, gachaType: number, data: GachaScheduleData): string {
  const mode = modeForGachaType(gachaType);
  const seriesId = getSeriesId(data.seriesMappings, gachaType, entry.id);
  const name = seriesId === undefined ? "不明" : data.shortSeriesNames[mode].get(seriesId) ?? "不明";
  return `${entry.id} s${seriesId ?? "?"} ${name}${entryLabels(entry)}${typeTag(gachaType)}`;
}

function itemLabel(entry: ItemEntry, data: ItemDisplayData): string {
  return `${entry.gift.giftType} ${getItemScheduleName(entry, data)}${entry.gift.giftAmount > 0 ? ` ×${entry.gift.giftAmount}` : ""}`;
}

function isVisible(header: Header, now: Date): boolean {
  return header.endDate !== "20300101" && parseHeaderDate(header.endDate, header.endTime) > now;
}

function formatSection(name: string, rows: Row[], now: Date): string {
  const unique = new Map(rows.map(row => [JSON.stringify([row.header.startDate, row.header.startTime, row.header.endDate, row.header.endTime, row.label]), row]));
  const visible = [...unique.values()].filter(row => isVisible(row.header, now))
    .sort((a, b) => parseHeaderDate(a.header.startDate, a.header.startTime).getTime() - parseHeaderDate(b.header.startDate, b.header.startTime).getTime());
  const groups = new Map<string, { title: string; labels: string[] }>();
  for (const row of visible.slice(0, skdDisplayLimit)) {
    const start = parseHeaderDate(row.header.startDate, row.header.startTime);
    const active = start <= now;
    const date = active ? parseHeaderDate(row.header.endDate, row.header.endTime) : start;
    const key = `${active}:${active ? row.header.endDate : row.header.startDate}`;
    const group = groups.get(key) ?? { title: active ? `🟢 [~${formatJstShort(date)}]` : `🟠 [${formatJstShort(date)}~]`, labels: [] };
    const label = row.label.replace(/`/g, " ").replace(/\r\n?/g, "\n");
    const lines = (name === "mission" ? label : label.replace(/\n/g, " ")).split("\n");
    group.labels.push(lines.map(line => `    ${line}`).join("\n").slice(0, 244));
    groups.set(key, group);
  }
  const lines = [...groups.values()].flatMap(group => [group.title, ...group.labels]);
  if (!lines.length) return "";
  if (visible.length > skdDisplayLimit) lines.push(`その他${visible.length - skdDisplayLimit}件`);
  return `**${name}**\n\`\`\`text\n${lines.join("\n")}\n\`\`\``;
}

function formatChanges(data: AddedScheduleData, now: Date): string {
  const rows: { type: string; label: string; before: SaleHeader; after: SaleHeader }[] = [];
  if (data.gatya) for (const change of data.changes?.gatya ?? []) {
    const entry = change.after.gachas[0];
    if (entry.id >= 0) rows.push({ type: "gatya", label: gachaLabel(entry, change.after.header.gachaType, data.gatya), before: change.before.header, after: change.after.header });
  }
  if (data.sale) for (const change of data.changes?.sale ?? []) {
    const id = change.after.stageIds[0];
    rows.push({ type: isMissionId(id) ? "mission" : "sale", label: `${id} ${getStageName(id, data.sale, { preserveLineBreaks: true })}`, before: change.before.header, after: change.after.header });
  }
  if (data.item) for (const change of data.changes?.item ?? []) {
    rows.push({ type: "item", label: itemLabel(change.after, data.item), before: change.before.header, after: change.after.header });
  }
  const order = ["gatya", "sale", "item", "mission"];
  const visible = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
    .filter(row => isVisible(row.after, now)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  if (!visible.length) return "";
  const dateTime = (date: string, time: string) => `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time.padStart(4, "0").slice(0, 2)}:${time.padStart(4, "0").slice(2, 4)}`;
  const lines = visible.slice(0, skdDisplayLimit).map(({ type, label, before, after }) => {
    const details: string[] = [];
    if (before.startDate !== after.startDate || before.startTime !== after.startTime) details.push(`開始: ${dateTime(before.startDate, before.startTime)} → ${dateTime(after.startDate, after.startTime)}`);
    if (before.endDate !== after.endDate || before.endTime !== after.endTime) details.push(`終了: ${dateTime(before.endDate, before.endTime)} → ${dateTime(after.endDate, after.endTime)}`);
    if (before.minVersion !== after.minVersion) details.push(`必要Ver: ${before.minVersion} → ${after.minVersion}`);
    if (before.maxVersion !== after.maxVersion) details.push(`上限Ver: ${before.maxVersion} → ${after.maxVersion}`);
    return `[${type}] ${label.slice(0, 120)}\n  ${details.join("\n  ")}`.replace(/`/g, " ").replace(/\r\n?/g, "\n").slice(0, 360);
  });
  if (visible.length > skdDisplayLimit) lines.push(`その他${visible.length - skdDisplayLimit}件`);
  return `**変更**\n\`\`\`text\n${lines.join("\n\n")}\n\`\`\``;
}

export function formatAddedSchedules(data: AddedScheduleData, now: Date, historyUrl: string): string[] {
  const rows: Record<"gatya" | "sale" | "item" | "mission", Row[]> = { gatya: [], sale: [], item: [], mission: [] };
  if (data.gatya) for (const block of data.gatya.gacha.data) {
    for (const entry of block.gachas) {
      if (entry.id < 0) continue;
      rows.gatya.push({ header: block.header, label: gachaLabel(entry, block.header.gachaType, data.gatya) });
    }
  }
  if (data.sale) for (const entry of data.sale.sale.data) {
    const duration = formatDuration(parseHeaderDate(entry.header.startDate, entry.header.startTime), parseHeaderDate(entry.header.endDate, entry.header.endTime));
    for (const id of getListStageIds(entry, data.sale.cardSettingStageIds)) rows.sale.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale)} ${duration}` });
    for (const id of entry.stageIds.filter(isMissionId)) rows.mission.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale, { preserveLineBreaks: true })} ${duration}` });
  }
  if (data.item) for (const entry of data.item.item.data) {
    rows.item.push({ header: entry.header, label: itemLabel(entry, data.item) });
  }
  return [...(["gatya", "sale", "item", "mission"] as const).map(type => formatSection(type, rows[type], now)), formatChanges(data, now), `**KBC**\n<${historyUrl}>`].filter(Boolean);
}
