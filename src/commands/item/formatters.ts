import {
  getItemDetailName,
  getItemScheduleName,
  isPermanentItem,
} from "./domain";
import { ItemDisplayData, ItemEntry, ItemTimeBlock } from "./types";

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

function parseTimeMinutes(value: string): number {
  const padded = value.padStart(4, "0");
  return Number(padded.slice(0, 2)) * 60 + Number(padded.slice(2, 4));
}

function formatMinutes(value: number): string {
  if (value >= 1_440) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function formatDateRangePoint(value: string): string {
  const parts = value.trim().split(/\s+/);
  const monthDay = parts[0].padStart(4, "0");
  const time = (parts[1] ?? "0").padStart(4, "0");
  return `${Number(monthDay.slice(0, 2))}/${Number(monthDay.slice(2, 4))} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

export function formatTimeBlock(block: ItemTimeBlock): string {
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
  const timePart = block.timeRanges.length === 0
    ? "終日"
    : block.timeRanges
        .map(
          ([start, end]) =>
            `${formatMinutes(parseTimeMinutes(start))}~${formatMinutes(parseTimeMinutes(end))}`,
        )
        .join("、");
  return `${dayPart}  ${timePart}`;
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      const point = Number.parseInt(code.slice(2), 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    if (code.startsWith("#")) {
      const point = Number.parseInt(code.slice(1), 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

export function formatGiftDetail(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatItemDetail(entry: ItemEntry, data: ItemDisplayData): string {
  const { gift, header } = entry;
  const start = parseHeaderDate(header.startDate, header.startTime);
  const endText = isPermanentItem(entry)
    ? "常設"
    : formatJstFull(parseHeaderDate(header.endDate, header.endTime));
  const amount = gift.giftAmount > 0 ? ` ×${gift.giftAmount}` : "";
  const lines = [
    getItemDetailName(gift.giftType, data),
    `${formatJstFull(start)} ~ ${endText}  ver.${header.minVersion}~${header.maxVersion}`,
    `eventId: ${gift.eventId}`,
    `giftType: ${gift.giftType}${amount}`,
  ];

  if (gift.repeatFlag === 0) lines.push("1回限り");

  const giftDetail = formatGiftDetail(data.itemNames.get(gift.giftType)?.detail ?? "");
  if (giftDetail) lines.push("", "ギフト詳細", giftDetail);

  const extras: string[] = [];
  if (gift.title) extras.push(gift.title);
  if (gift.message) extras.push(gift.message.replace(/<br>/gi, "\n"));
  if (gift.url) extras.push(gift.url);
  if (extras.length > 0) lines.push("", ...extras);

  if (entry.timeBlocks.length > 0) {
    lines.push("");
    for (const block of entry.timeBlocks) lines.push(`・${formatTimeBlock(block)}`);
  }
  return lines.join("\n");
}

interface ScheduleGroup {
  active: boolean;
  period: string;
  entries: ItemEntry[];
}

export function formatItemSchedule(
  data: ItemDisplayData,
  now: Date,
): string | undefined {
  const entries = data.item.data
    .filter((entry) => {
      if (isPermanentItem(entry)) return false;
      return parseHeaderDate(entry.header.endDate, entry.header.endTime) > now;
    })
    .sort(
      (left, right) =>
        parseHeaderDate(left.header.startDate, left.header.startTime).getTime() -
        parseHeaderDate(right.header.startDate, right.header.startTime).getTime(),
    );

  const groups = new Map<string, ScheduleGroup>();
  for (const entry of entries) {
    const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
    const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
    const active = now >= start && now < end;
    const dateKey = active ? entry.header.endDate : entry.header.startDate;
    const groupKey = `${active ? "active" : "upcoming"}:${dateKey}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        active,
        period: active ? `~${formatJstShort(end)}` : `${formatJstShort(start)}~`,
        entries: [],
      };
      groups.set(groupKey, group);
    }
    group.entries.push(entry);
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    lines.push(`${group.active ? "🟢 " : ""}[${group.period}]`);
    for (const entry of group.entries) {
      const amount = entry.gift.giftAmount > 0 ? ` ×${entry.gift.giftAmount}` : "";
      lines.push(
        `    ${entry.gift.giftType} ${getItemScheduleName(entry, data)}${amount}`,
      );
    }
  }

  if (lines.length === 0) return undefined;
  return `アイテムスケジュール [開催中＆予定]\n\n${lines.join("\n")}`;
}
