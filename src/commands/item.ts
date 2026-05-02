import { Message, TextChannel } from "discord.js";

const ITEM_JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/item.json";
const ITEM_NAME_CSV_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/item_name.csv";

const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_JA_MAP: Record<string, string> = {
  Sun: "日", Mon: "月", Tue: "火", Wed: "水",
  Thu: "木", Fri: "金", Sat: "土",
};
const SPINNER_FRAMES = [
  "- 処理中.",
  "\\ 処理中..",
  "| 処理中...",
  "/ 処理中",
];

interface ItemHeader {
  startDate: string; startTime: string;
  endDate: string; endTime: string;
  minVersion: string; maxVersion: string;
}
interface DateRange { start: string; end: string; }
interface TimeBlock {
  dateRanges: DateRange[];
  monthDays: number[];
  weekdays: string[];
  timeRanges: string[][];
}
interface Gift {
  eventId: number; giftType: number; giftAmount: number;
  title: string; message: string; url: string; repeatFlag: number;
}
interface ItemEntry {
  header: ItemHeader; timeBlocks: TimeBlock[]; gift: Gift; raw?: string;
}
interface ItemJson { updatedAt: string; data: ItemEntry[]; }

async function createSpinner(channel: TextChannel) {
  const msg = await channel.send(SPINNER_FRAMES[0]);
  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    msg.edit(SPINNER_FRAMES[frame]).catch(() => {});
  }, 400);
  return { msg, stop() { clearInterval(interval); } };
}

async function fetchItemJson(): Promise<ItemJson> {
  const res = await fetch(ITEM_JSON_URL);
  return (await res.json()) as ItemJson;
}

async function fetchNameMap(): Promise<Map<number, string>> {
  const res = await fetch(ITEM_NAME_CSV_URL);
  const text = await res.text();
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const ci = t.indexOf(",");
    if (ci === -1) continue;
    const id = parseInt(t.slice(0, ci));
    if (isNaN(id) || id === -1) continue;
    const rest = t.slice(ci + 1);
    const ci2 = rest.indexOf(",");
    const name = ci2 === -1 ? rest.trim() : rest.slice(0, ci2).trim();
    if (name) map.set(id, name);
  }
  return map;
}

function parseHeaderDate(dateStr: string, timeStr: string): Date {
  const d = dateStr.padStart(8, "0");
  const t = timeStr.padStart(4, "0");
  return new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00+09:00`
  );
}

function formatJSTFull(date: Date): string {
  const jst = new Date(date.getTime() + JST_MS);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const wd = WEEKDAYS_JA[jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}年${m}月${d}日(${wd}) ${hh}:${mm}`;
}

function formatDateShort(date: Date): string {
  const jst = new Date(date.getTime() + JST_MS);
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const wd = WEEKDAYS_JA[jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${mo}/${d}(${wd}) ${hh}:${mm}`;
}

function isPermanent(entry: ItemEntry): boolean {
  return entry.header.endDate === "20300101";
}

function parseTimeMin(s: string): number {
  const p = s.padStart(4, "0");
  return parseInt(p.slice(0, 2)) * 60 + parseInt(p.slice(2, 4));
}

function fmtMin(m: number): string {
  if (m >= 1440) return "24:00";
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function parseDRPoint(s: string): string {
  const parts = s.trim().split(" ");
  const mmdd = parts[0].padStart(4, "0");
  const month = parseInt(mmdd.slice(0, 2));
  const day = parseInt(mmdd.slice(2, 4));
  const ts = (parts[1] ?? "0").padStart(4, "0");
  return `${month}/${day} ${ts.slice(0, 2)}:${ts.slice(2, 4)}`;
}

function formatTimeBlock(block: TimeBlock): string {
  let dayPart: string;
  if (block.weekdays.length > 0) {
    const days = block.weekdays.map(w => WEEKDAY_JA_MAP[w] ?? w).join("・");
    dayPart = `毎週${days}曜`;
  } else if (block.monthDays.length > 0) {
    dayPart = `毎月${block.monthDays.join(",")}日`;
  } else if (block.dateRanges.length > 0) {
    dayPart = block.dateRanges.map(r => `${parseDRPoint(r.start)}~${parseDRPoint(r.end)}`).join(" / ");
  } else {
    dayPart = "毎日";
  }
  const timePart = block.timeRanges.length === 0
    ? "終日"
    : block.timeRanges.map(([s, e]) => `${fmtMin(parseTimeMin(s))}~${fmtMin(parseTimeMin(e))}`).join("、");
  return `${dayPart}  ${timePart}`;
}

function formatEntryDetail(entry: ItemEntry, nameMap: Map<number, string>): string {
  const { header, timeBlocks, gift } = entry;
  const start = parseHeaderDate(header.startDate, header.startTime);
  const perm = isPermanent(entry);
  const end = perm ? null : parseHeaderDate(header.endDate, header.endTime);
  const lines: string[] = [];

  lines.push(`giftType: ${gift.giftType}`);
  const endStr = perm ? "常設" : formatJSTFull(end!);
  lines.push(`${formatJSTFull(start)} ~ ${endStr}  ver.${header.minVersion}~${header.maxVersion}`);
  lines.push(`eventId: ${gift.eventId}`);

  const itemName = nameMap.get(gift.giftType) ?? "不明";
  const amountStr = gift.giftAmount > 0 ? ` ×${gift.giftAmount}` : "";
  lines.push(`${itemName}${amountStr}`);

  if (gift.repeatFlag === 0) lines.push("1回限り");

  const extras: string[] = [];
  if (gift.title) extras.push(gift.title);
  if (gift.message) extras.push(gift.message.replace(/<br>/gi, "\n"));
  if (gift.url) extras.push(gift.url);
  if (extras.length > 0) { lines.push(""); lines.push(...extras); }

  if (timeBlocks.length > 0) {
    lines.push("");
    for (const block of timeBlocks) lines.push(`・${formatTimeBlock(block)}`);
  }

  return lines.join("\n");
}

async function sendChunked(channel: TextChannel, text: string, lang = ""): Promise<void> {
  const rawLines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of rawLines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > 1800) { chunks.push(current); current = line; }
    else { current = current ? current + "\n" + line : line; }
  }
  if (current) chunks.push(current);
  const open = lang ? `\`\`\`${lang}\n` : "```\n";
  for (const chunk of chunks) await channel.send(open + chunk + "\n```");
}

async function searchEntries(
  id: number, json: ItemJson
): Promise<{ entries: ItemEntry[]; notified: boolean }> {
  const byGiftType = json.data.filter(e => e.gift.giftType === id);
  if (byGiftType.length > 0) return { entries: byGiftType, notified: false };
  const byEventId = json.data.filter(e => e.gift.eventId === id);
  return { entries: byEventId, notified: true };
}

async function handleSchedule(channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: ItemJson;
  let nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchItemJson(), fetchNameMap()]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const now = new Date();
  const filtered = json.data.filter(e => {
    if (isPermanent(e)) return false;
    return parseHeaderDate(e.header.endDate, e.header.endTime) > now;
  });

  if (filtered.length === 0) {
    await spinner.msg.edit("開催中・予定のアイテム配布はありません");
    return;
  }

  filtered.sort((a, b) =>
    parseHeaderDate(a.header.startDate, a.header.startTime).getTime() -
    parseHeaderDate(b.header.startDate, b.header.startTime).getTime()
  );

  const lines: string[] = [];
  for (const entry of filtered) {
    const { gift, header } = entry;
    const start = parseHeaderDate(header.startDate, header.startTime);
    const end = parseHeaderDate(header.endDate, header.endTime);
    const emoji = start <= now ? "🟢" : "🔵";
    const itemName = nameMap.get(gift.giftType) ?? "不明";
    const amountStr = gift.giftAmount > 0 ? ` ×${gift.giftAmount}` : "";
    lines.push(`${emoji} ${formatDateShort(start)} ~ ${formatDateShort(end)}`);
    lines.push(`    ${gift.giftType} ${itemName}${amountStr}`);
    if (gift.title) lines.push(`    ${gift.title}`);
    lines.push("");
  }

  await spinner.msg.delete().catch(() => {});
  await sendChunked(channel, lines.join("\n"));
}

async function handleSearch(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: ItemJson;
  let nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchItemJson(), fetchNameMap()]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const { entries, notified } = await searchEntries(id, json);
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ \`${id}\` は giftType・eventID のどちらでも見つかりませんでした`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  if (notified) await channel.send(`ℹ️ giftType \`${id}\` では見つからなかった為、eventID で検索しました`);
  for (const entry of entries) await sendChunked(channel, formatEntryDetail(entry, nameMap));
}

async function handleJson(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: ItemJson;
  try { json = await fetchItemJson(); }
  catch { spinner.stop(); await spinner.msg.edit("❌ データ取得に失敗しました"); return; }
  spinner.stop();

  const { entries, notified } = await searchEntries(id, json);
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ \`${id}\` は giftType・eventID のどちらでも見つかりませんでした`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  if (notified) await channel.send(`ℹ️ giftType \`${id}\` では見つからなかった為、eventID で検索しました`);
  for (const entry of entries) {
    const { raw: _raw, ...entryData } = entry;
    await sendChunked(channel, JSON.stringify(entryData, null, 2), "json");
  }
}

async function handleRaw(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: ItemJson;
  try { json = await fetchItemJson(); }
  catch { spinner.stop(); await spinner.msg.edit("❌ データ取得に失敗しました"); return; }
  spinner.stop();

  const { entries, notified } = await searchEntries(id, json);
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ \`${id}\` は giftType・eventID のどちらでも見つかりませんでした`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  if (notified) await channel.send(`ℹ️ giftType \`${id}\` では見つからなかった為、eventID で検索しました`);
  for (const entry of entries) {
    if (!entry.raw) { await channel.send(`❌ (startDate: \`${entry.header.startDate}\`) に raw データがありません`); continue; }
    await sendChunked(channel, entry.raw.replace(/\t/g, "    "));
  }
}

const item = {
  name: "item",
  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) { await handleSchedule(channel); return; }

    const last = args[args.length - 1].toLowerCase();
    const secondLast = args.length >= 2 ? args[args.length - 2] : "";
    const secondLastNum = parseInt(secondLast);
    const isSecondLastNum = !isNaN(secondLastNum) && String(secondLastNum) === secondLast;

    if ((last === "j" || last === "json") && isSecondLastNum) { await handleJson(secondLastNum, channel); return; }
    if (last === "r" && isSecondLastNum) { await handleRaw(secondLastNum, channel); return; }

    const num = parseInt(args[0]);
    if (!isNaN(num) && String(num) === args[0].trim()) { await handleSearch(num, channel); return; }

    const err = await channel.send(
      "❌ 使い方:\n　`o.item` — アイテム配布一覧\n　`o.item <ID>` — giftType/eventIDで検索\n　`o.item <ID> j` — JSON表示\n　`o.item <ID> r` — Raw表示"
    );
    setTimeout(() => err.delete().catch(() => {}), 12_000);
  },
};

module.exports = item;