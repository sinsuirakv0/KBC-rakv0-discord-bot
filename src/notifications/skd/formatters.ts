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
interface Row { header: Header; label: string; id?: number; }
interface CodeGroup { title: string; labels: string[]; }
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

function isPermanent(header: Header): boolean {
  return header.endDate === "20300101";
}

function isVisible(header: Header, now: Date): boolean {
  return isPermanent(header) || parseHeaderDate(header.endDate, header.endTime) > now;
}

function formatCodeBlocks(name: string, groups: CodeGroup[], separator = "\n"): string[] {
  const wrap = (lines: string[]) => `**${name}**\n\`\`\`text\n${lines.join(separator)}\n\`\`\``;
  const parts: string[] = [];
  let lines: string[] = [];
  let lastTitle = "";
  for (const group of groups) for (const label of group.labels) {
    const title = !lines.length || lastTitle !== group.title ? group.title : "";
    let next = [...lines, ...(title ? [title] : []), label];
    if (wrap(next).length > 2000 && lines.length) {
      parts.push(wrap(lines));
      next = [...(group.title ? [group.title] : []), label];
    }
    if (wrap(next).length > 2000) throw new Error(`Schedule ${name} entry exceeds message limit`);
    lines = next;
    lastTitle = group.title;
  }
  if (lines.length) parts.push(wrap(lines));
  return parts;
}

function missionFooters(ids: number[]): string[] {
  const prefix = `その他${ids.length}件(`;
  const footers: string[] = [];
  let values: string[] = [];
  for (const id of ids) {
    if (prefix.length + [...values, String(id)].join(",").length + 1 > 1900 && values.length) {
      footers.push(`${prefix}${values.join(",")})`);
      values = [];
    }
    values.push(String(id));
  }
  if (values.length) footers.push(`${prefix}${values.join(",")})`);
  return footers;
}

function formatSection(name: string, rows: Row[], now: Date): string[] {
  const unique = new Map(rows.map(row => [JSON.stringify([row.header.startDate, row.header.startTime, row.header.endDate, row.header.endTime, row.label]), row]));
  const visible = [...unique.values()].filter(row => isVisible(row.header, now))
    .sort((a, b) => parseHeaderDate(a.header.startDate, a.header.startTime).getTime() - parseHeaderDate(b.header.startDate, b.header.startTime).getTime());
  const groups = new Map<string, CodeGroup>();
  for (const row of (name === "mission" ? visible.slice(0, skdDisplayLimit) : visible)) {
    const start = parseHeaderDate(row.header.startDate, row.header.startTime);
    const active = start <= now;
    const permanent = isPermanent(row.header);
    const useEnd = active && !permanent;
    const date = useEnd ? parseHeaderDate(row.header.endDate, row.header.endTime) : start;
    const key = `${permanent}:${active}:${useEnd ? row.header.endDate : row.header.startDate}`;
    const period = useEnd ? `[~${formatJstShort(date)}]` : `[${formatJstShort(date)}~]`;
    const group = groups.get(key) ?? { title: `${active ? "🟢 " : ""}${period}${permanent ? " 常設" : ""}`, labels: [] };
    const label = row.label.replace(/`/g, " ").replace(/\r\n?/g, "\n");
    const lines = (name === "mission" ? label : label.replace(/\n/g, " ")).split("\n");
    group.labels.push(lines.map(line => `    ${line}`).join("\n").slice(0, 244));
    groups.set(key, group);
  }
  if (name === "mission" && visible.length > skdDisplayLimit) {
    groups.set("omitted", { title: "", labels: missionFooters(visible.slice(skdDisplayLimit).map(row => row.id!)) });
  }
  return formatCodeBlocks(name, [...groups.values()]);
}

function formatChanges(data: AddedScheduleData, now: Date): string[] {
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
  if (!visible.length) return [];
  const dateTime = (date: string, time: string) => `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time.padStart(4, "0").slice(0, 2)}:${time.padStart(4, "0").slice(2, 4)}`;
  const endDateTime = (header: Header) => isPermanent(header) ? "常設" : dateTime(header.endDate, header.endTime);
  const lines = visible.map(({ type, label, before, after }) => {
    const details: string[] = [];
    if (before.startDate !== after.startDate || before.startTime !== after.startTime) details.push(`開始: ${dateTime(before.startDate, before.startTime)} → ${dateTime(after.startDate, after.startTime)}`);
    if (before.endDate !== after.endDate || before.endTime !== after.endTime) details.push(`終了: ${endDateTime(before)} → ${endDateTime(after)}`);
    if (before.minVersion !== after.minVersion) details.push(`必要Ver: ${before.minVersion} → ${after.minVersion}`);
    if (before.maxVersion !== after.maxVersion) details.push(`上限Ver: ${before.maxVersion} → ${after.maxVersion}`);
    return `[${type}] ${label.slice(0, 120)}\n  ${details.join("\n  ")}`.replace(/`/g, " ").replace(/\r\n?/g, "\n").slice(0, 360);
  });
  return formatCodeBlocks("変更", [{ title: "", labels: lines }], "\n\n");
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
    const duration = isPermanent(entry.header) ? "" : ` ${formatDuration(parseHeaderDate(entry.header.startDate, entry.header.startTime), parseHeaderDate(entry.header.endDate, entry.header.endTime))}`;
    for (const id of getListStageIds(entry, data.sale.cardSettingStageIds)) rows.sale.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale)}${duration}` });
    for (const id of entry.stageIds.filter(isMissionId)) rows.mission.push({ header: entry.header, label: `${id} ${getStageName(id, data.sale, { preserveLineBreaks: true })}${duration}`, id });
  }
  if (data.item) for (const entry of data.item.item.data) {
    rows.item.push({ header: entry.header, label: itemLabel(entry, data.item) });
  }
  return [...(["gatya", "sale", "item", "mission"] as const).flatMap(type => formatSection(type, rows[type], now)),
    ...formatChanges(data, now), `**KBC**\n<${historyUrl}>`];
}
