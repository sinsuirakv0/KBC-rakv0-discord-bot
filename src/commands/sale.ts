import { Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";
import { isHidden } from "../config/saleHiddenConfig";

// ================================
// URLs
// ================================
const SALE_JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale.json";
const SALE_NAME_CSV_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale_name.csv";

// ================================
// 定数
// ================================
const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_JA_MAP: Record<string, string> = {
  Sun: "日", Mon: "月", Tue: "火", Wed: "水", Thu: "木", Fri: "金", Sat: "土",
};

// ================================
// 型定義
// ================================
interface SaleHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
}

interface DateRange {
  start: string;
  end: string;
}

interface TimeBlock {
  dateRanges: DateRange[];
  monthDays: number[];
  weekdays: string[];
  timeRanges: string[][];
}

interface SaleEntry {
  header: SaleHeader;
  timeBlocks: TimeBlock[];
  stageIds: number[];
  raw?: string;
}

interface SaleJson {
  updatedAt: string;
  data: SaleEntry[];
}

// ================================
// データ取得
// ================================
async function fetchSaleJson(): Promise<SaleJson> {
  const res = await fetch(SALE_JSON_URL);
  return (await res.json()) as SaleJson;
}

async function fetchNameMap(): Promise<Map<number, string>> {
  const res = await fetch(SALE_NAME_CSV_URL);
  const text = await res.text();
  const map = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const ci = t.indexOf(",");
    if (ci === -1) continue;
    const id = parseInt(t.slice(0, ci));
    if (!isNaN(id)) map.set(id, t.slice(ci + 1).trim());
  }
  return map;
}

// ================================
// 日付ユーティリティ
// ================================
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
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const wd = WEEKDAYS_JA[jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${m}/${d}(${wd}) ${hh}:${mm}`;
}

function isPermanent(entry: SaleEntry): boolean {
  return entry.header.endDate === "20300101";
}

function isActive(entry: SaleEntry, now: Date): boolean {
  const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
  const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
  return now >= start && now < end;
}

function isFuture(entry: SaleEntry, now: Date): boolean {
  const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
  return start > now;
}

// ================================
// タイムブロック表示
// ================================
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
    dayPart = block.dateRanges
      .map(r => `${parseDRPoint(r.start)}~${parseDRPoint(r.end)}`)
      .join(" / ");
  } else {
    dayPart = "毎日";
  }

  let timePart: string;
  if (block.timeRanges.length === 0) {
    timePart = "終日";
  } else {
    timePart = block.timeRanges
      .map(([s, e]) => `${fmtMin(parseTimeMin(s))}~${fmtMin(parseTimeMin(e))}`)
      .join("、");
  }

  return `${dayPart}  ${timePart}`;
}

// ================================
// エントリ詳細フォーマット
// ================================
function formatEntryDetail(entry: SaleEntry, nameMap: Map<number, string>): string {
  const { header, timeBlocks, stageIds } = entry;
  const start = parseHeaderDate(header.startDate, header.startTime);
  const perm = isPermanent(entry);
  const end = perm ? null : parseHeaderDate(header.endDate, header.endTime);

  const lines: string[] = [];

  // ID + 名前（非表示除外）
  const validIds = stageIds.filter(id => id >= 0 && !isHidden(id));
  for (const id of validIds) {
    const name = nameMap.get(id) ?? "不明";
    lines.push(`${id} ${name}`);
  }

  const endStr = perm ? "常設" : formatJSTFull(end!);
  lines.push(`${formatJSTFull(start)} ~ ${endStr}  ver.${header.minVersion}~${header.maxVersion}`);

  if (timeBlocks.length === 0) {
    lines.push("・常時開催（時間制限なし）");
  } else {
    for (const block of timeBlocks) {
      lines.push(`・${formatTimeBlock(block)}`);
    }
  }

  return lines.join("\n");
}

// ================================
// チャンク送信ヘルパー（Discord 2000文字上限対応）
// ================================
async function sendChunked(
  channel: TextChannel,
  text: string,
  lang = ""
): Promise<void> {
  const rawLines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of rawLines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > 1800) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);

  const open = lang ? `\`\`\`${lang}\n` : "```\n";
  for (const chunk of chunks) {
    await channel.send(open + chunk + "\n```");
  }
}

// ================================
// ハンドラー: 名前 / ID 検索
// ================================
async function handleSearch(query: string, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  let json: SaleJson;
  let nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchSaleJson(), fetchNameMap()]);
  } catch {
    await processingMsg.edit("❌ データ取得に失敗しました");
    return;
  }

  const now = new Date();
  const num = parseInt(query);
  const isNumericQuery = !isNaN(num) && String(num) === query.trim();

  let matchedIds: number[] = [];

  if (isNumericQuery) {
    if (nameMap.has(num) || json.data.some(e => e.stageIds.includes(num))) {
      matchedIds.push(num);
    }
  } else {
    const q = query.toLowerCase();
    for (const [id, name] of nameMap) {
      if (name.toLowerCase().includes(q)) {
        matchedIds.push(id);
      }
    }
  }

  // 非表示IDを除外
  matchedIds = matchedIds.filter(id => !isHidden(id));

  if (matchedIds.length === 0) {
    await processingMsg.edit(`❌ \`${query}\` に一致するイベントは見つかりませんでした`);
    return;
  }

  const lines: string[] = [];
  for (const id of matchedIds) {
    const name = nameMap.get(id) ?? "不明";
    const entries = json.data.filter(e => e.stageIds.includes(id));

    let statusEmoji: string;
    if (entries.length === 0) {
      statusEmoji = "❓";
    } else {
      const allPerm = entries.every(e => isPermanent(e));
      const anyActive = entries.some(e => isActive(e, now));
      const anyFuture = entries.some(e => isFuture(e, now));

      if (allPerm) statusEmoji = "🔒";
      else if (anyActive) statusEmoji = "🟢";
      else if (anyFuture) statusEmoji = "🔵";
      else statusEmoji = "⬛";
    }

    lines.push(`${statusEmoji} ${id}  ${name}`);
  }

  await processingMsg.delete().catch(() => void 0);

  const header = `「${query}」の検索結果 (${matchedIds.length}件)\n🟢開催中 🔵予定 🔒常設 ⬛終了`;
  await sendChunked(channel, header + "\n\n" + lines.join("\n"));
}

// ================================
// ハンドラー: スケジュール一覧
// ================================
async function handleSchedule(
  filter: "c" | "f" | "all",
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ スケジュール取得中...");

  let json: SaleJson;
  let nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchSaleJson(), fetchNameMap()]);
  } catch {
    await processingMsg.edit("❌ データ取得に失敗しました");
    return;
  }

  const now = new Date();
  const nonPerm = json.data.filter(e => !isPermanent(e));

  const filtered = nonPerm.filter(e => {
    const end = parseHeaderDate(e.header.endDate, e.header.endTime);
    if (end <= now) return false;
    if (filter === "c") return isActive(e, now);
    if (filter === "f") return isFuture(e, now);
    return true;
  });

  if (filtered.length === 0) {
    const label = filter === "c" ? "開催中" : filter === "f" ? "予定" : "開催中・予定";
    await processingMsg.edit(`${label}のセールイベントはありません`);
    return;
  }

  filtered.sort(
    (a, b) =>
      parseHeaderDate(a.header.startDate, a.header.startTime).getTime() -
      parseHeaderDate(b.header.startDate, b.header.startTime).getTime()
  );

  const lines: string[] = [];
  for (const entry of filtered) {
    // 非表示除外した有効ID
    const validIds = entry.stageIds.filter(id => id >= 0 && !isHidden(id));
    if (validIds.length === 0) continue;

    const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
    const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
    const emoji = isActive(entry, now) ? "🟢" : "🔵";
    const period = `${formatDateShort(start)} ~ ${formatDateShort(end)}`;

    // 日時は必ず1行目、IDと名前は必ず別行（改行）
    lines.push(`${emoji} ${period}`);
    for (const id of validIds) {
      const name = nameMap.get(id) ?? "不明";
      lines.push(`    ${id} ${name}`);
    }
    lines.push(""); // エントリ間の区切り
  }

  if (lines.length === 0) {
    const label = filter === "c" ? "開催中" : filter === "f" ? "予定" : "開催中・予定";
    await processingMsg.edit(`${label}のセールイベントはありません（非表示設定により表示対象なし）`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  const filterLabel = filter === "c" ? "開催中" : filter === "f" ? "予定" : "開催中＆予定";
  await sendChunked(channel, `セールスケジュール [${filterLabel}]\n\n` + lines.join("\n"));
}

// ================================
// ハンドラー: ID詳細
// ================================
async function handleDetail(id: number, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ 詳細取得中...");

  let json: SaleJson;
  let nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchSaleJson(), fetchNameMap()]);
  } catch {
    await processingMsg.edit("❌ データ取得に失敗しました");
    return;
  }

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const entry of entries) {
    await sendChunked(channel, formatEntryDetail(entry, nameMap));
  }
}

// ================================
// ハンドラー: JSON表示
// ================================
async function handleJson(id: number, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ 取得中...");

  let json: SaleJson;
  try {
    json = await fetchSaleJson();
  } catch {
    await processingMsg.edit("❌ データ取得に失敗しました");
    return;
  }

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const entry of entries) {
    const { raw: _raw, ...entryData } = entry;
    await sendChunked(channel, JSON.stringify(entryData, null, 2), "json");
  }
}

// ================================
// ハンドラー: Raw表示
// ================================
async function handleRaw(id: number, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ 取得中...");

  let json: SaleJson;
  try {
    json = await fetchSaleJson();
  } catch {
    await processingMsg.edit("❌ データ取得に失敗しました");
    return;
  }

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const entry of entries) {
    if (!entry.raw) {
      await channel.send(`❌ (startDate: \`${entry.header.startDate}\`) に raw データがありません`);
      continue;
    }
    await sendChunked(channel, entry.raw.replace(/\t/g, "    "));
  }
}

// ================================
// コマンド本体
// ================================
const sale: Command = {
  name: "sale",
  description: "セールイベントの検索・スケジュール表示",
  usage: [
    "o.sale <名前orID>         : 名前またはIDで検索",
    "o.sale s [c|f]            : スケジュール一覧 (c=開催中 f=予定 省略=両方)",
    "o.sale s <ID> [r|j]       : IDの詳細 (r=raw j=json 省略=整形表示)",
  ].join("\n"),

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      const err = await channel.send(
        [
          "❌ 使い方:",
          "　`o.sale <名前orID>` — 名前またはIDで検索",
          "　`o.sale s` — スケジュール一覧（開催中＋予定）",
          "　`o.sale s c` — 開催中のみ",
          "　`o.sale s f` — 予定のみ",
          "　`o.sale s <ID>` — IDの詳細表示",
          "　`o.sale s <ID> r` — raw表示",
          "　`o.sale s <ID> j` — JSON表示",
        ].join("\n")
      );
      setTimeout(() => err.delete().catch(() => void 0), 12_000);
      return;
    }

    if (args[0] === "s") {
      const rest = args.slice(1);

      if (rest.length === 0) {
        await handleSchedule("all", channel);
        return;
      }

      const first = rest[0].toLowerCase();

      if (first === "c" || first === "f") {
        await handleSchedule(first, channel);
        return;
      }

      const idNum = parseInt(first);
      if (!isNaN(idNum) && String(idNum) === first) {
        const mod = rest[1]?.toLowerCase();
        if (mod === "r") {
          await handleRaw(idNum, channel);
        } else if (mod === "j" || mod === "json") {
          await handleJson(idNum, channel);
        } else {
          await handleDetail(idNum, channel);
        }
        return;
      }

      await handleSchedule("all", channel);
      return;
    }

    await handleSearch(args.join(" "), channel);
  },
};

module.exports = sale;
