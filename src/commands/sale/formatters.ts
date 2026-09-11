import {
  getListStageIds,
  getRepresentativeStageId,
  getStageName,
  StageNameSources,
} from "./domain";
import { SaleDisplayData, SaleEntry, TimeBlock } from "./types";

const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_JA_MAP: Readonly<Record<string, string>> = {
  Sun: "日",
  Mon: "月",
  Tue: "火",
  Wed: "水",
  Thu: "木",
  Fri: "金",
  Sat: "土",
};

export function parseHeaderDate(dateText: string, timeText: string): Date {
  const date = dateText.padStart(8, "0");
  const time = timeText.padStart(4, "0");
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
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

export function formatDuration(start: Date, end: Date): string {
  let remainingMinutes = Math.max(
    0,
    Math.floor((end.getTime() - start.getTime()) / 60_000),
  );
  const days = Math.floor(remainingMinutes / 1_440);
  remainingMinutes %= 1_440;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return `<${parts.length > 0 ? parts.join("") : "0m"}>`;
}

export function isPermanent(entry: SaleEntry): boolean {
  return entry.header.endDate === "20300101";
}

export function isActive(entry: SaleEntry, now: Date): boolean {
  const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
  const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
  return now >= start && now < end;
}

function parseTimeMinutes(value: string): number {
  const padded = value.padStart(4, "0");
  return Number(padded.slice(0, 2)) * 60 + Number(padded.slice(2, 4));
}

function formatMinutes(value: number): string {
  if (value >= 1_440) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatDateRangePoint(value: string): string {
  const parts = value.trim().split(" ");
  const monthDay = parts[0].padStart(4, "0");
  const time = (parts[1] ?? "0").padStart(4, "0");
  return `${Number(monthDay.slice(0, 2))}/${Number(monthDay.slice(2, 4))} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

export function formatTimeBlock(block: TimeBlock): string {
  let dayPart: string;
  if (block.weekdays.length > 0) {
    const weekdays = block.weekdays
      .map((weekday) => WEEKDAY_JA_MAP[weekday] ?? weekday)
      .join("・");
    dayPart = `毎週${weekdays}曜`;
  } else if (block.monthDays.length > 0) {
    dayPart = `毎月${block.monthDays.join(",")}日`;
  } else if (block.dateRanges.length > 0) {
    dayPart = block.dateRanges
      .map(
        (range) =>
          `${formatDateRangePoint(range.start)}~${formatDateRangePoint(range.end)}`,
      )
      .join(" / ");
  } else {
    dayPart = "毎日";
  }
  const timePart =
    block.timeRanges.length === 0
      ? "終日"
      : block.timeRanges
          .map(
            ([start, end]) =>
              `${formatMinutes(parseTimeMinutes(start))}~${formatMinutes(parseTimeMinutes(end))}`,
          )
          .join("、");
  return `${dayPart}  ${timePart}`;
}

interface ScheduleItem {
  active: boolean;
  period: string;
  startDateKey: string;
  endDateKey: string;
  stageIds: readonly number[];
  duration: string;
}

interface ScheduleGroup {
  active: boolean;
  period: string;
  items: ScheduleItem[];
}

function normalizeScheduleDateKey(value: string): string {
  return value.trim().padStart(8, "0");
}

function groupScheduleItems(items: readonly ScheduleItem[]): readonly ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>();
  for (const item of items) {
    // 予定は開始日、開催中は終了日が同じ場合に、同じ見出しへまとめる。
    const dateKey = item.active ? item.endDateKey : item.startDateKey;
    const groupKey = `${item.active ? "active" : "upcoming"}:${dateKey}`;
    const group = groups.get(groupKey);
    if (group) group.items.push(item);
    else groups.set(groupKey, { active: item.active, period: item.period, items: [item] });
  }
  return [...groups.values()];
}

export function formatEntryDetail(
  entry: SaleEntry,
  nameSources: StageNameSources,
  cardSettingStageIds: readonly number[],
  selectedId: number,
): string {
  const lines: string[] = [];
  const representativeId = getRepresentativeStageId(entry, cardSettingStageIds);
  if (representativeId !== undefined && representativeId === selectedId) {
    lines.push(`${representativeId} ${getStageName(representativeId, nameSources)}`);
    const targetStages = entry.stageIds
      .filter((id) => id !== representativeId)
      .map((id) => `${id} ${getStageName(id, nameSources)}`);
    if (targetStages.length > 0) {
      lines.push(`対象ステージ: ${targetStages.join("、")}`);
    }
  } else {
    lines.push(`${selectedId} ${getStageName(selectedId, nameSources)}`);
  }

  const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
  const endText = isPermanent(entry)
    ? "常設"
    : formatJstFull(parseHeaderDate(entry.header.endDate, entry.header.endTime));
  lines.push(
    `${formatJstFull(start)} ~ ${endText}  ver.${entry.header.minVersion}~${entry.header.maxVersion}`,
  );
  if (entry.timeBlocks.length === 0) {
    lines.push("・常時開催（時間制限なし）");
  } else {
    for (const block of entry.timeBlocks) lines.push(`・${formatTimeBlock(block)}`);
  }
  return lines.join("\n");
}

export function formatSchedule(
  data: SaleDisplayData,
  now: Date,
): string | undefined {
  const nameSources: StageNameSources = data;
  const entries = data.sale.data
    .filter((entry) => {
      if (isPermanent(entry)) return false;
      const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
      return end > now;
    })
    .sort(
      (left, right) =>
        parseHeaderDate(left.header.startDate, left.header.startTime).getTime() -
        parseHeaderDate(right.header.startDate, right.header.startTime).getTime(),
    );

  const items: ScheduleItem[] = [];
  for (const entry of entries) {
    const stageIds = getListStageIds(entry, data.cardSettingStageIds);
    if (stageIds.length === 0) continue;
    const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
    const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
    const active = isActive(entry, now);
    const period = active ? `~${formatJstShort(end)}` : `${formatJstShort(start)}~`;
    const duration = formatDuration(start, end);

    items.push({
      active,
      period,
      startDateKey: normalizeScheduleDateKey(entry.header.startDate),
      endDateKey: normalizeScheduleDateKey(entry.header.endDate),
      stageIds,
      duration,
    });
  }

  const lines: string[] = [];
  for (const group of groupScheduleItems(items)) {
    lines.push(`${group.active ? "🟢 " : ""}[${group.period}]`);
    for (const item of group.items) {
      for (const id of item.stageIds) {
        lines.push(`    ${id} ${getStageName(id, nameSources)} ${item.duration}`);
      }
    }
  }

  if (lines.length === 0) return undefined;
  return `セールスケジュール [開催中＆予定]\n\n${lines.join("\n")}`;
}
