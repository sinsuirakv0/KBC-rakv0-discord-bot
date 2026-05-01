import {
  Message,
  TextChannel,
  MessageReaction,
  User,
} from "discord.js";

const SALE_JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale.json";
const SALE_NAME_CSV_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/sale_name.csv";

const JST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAY_JA_MAP: Record<string, string> = {
  Sun: "日", Mon: "月", Tue: "火", Wed: "水",
  Thu: "木", Fri: "金", Sat: "土",
};
const NUMBER_EMOJIS = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];
const SPINNER_FRAMES = [
  "- 処理中.",
  "\\ 処理中..",
  "| 処理中...",
  "/ 処理中",
];

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
interface DateRange { start: string; end: string; }
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
// スピナー
// ================================
async function createSpinner(channel: TextChannel) {
  const msg = await channel.send(SPINNER_FRAMES[0]);
  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    msg.edit(SPINNER_FRAMES[frame]).catch(() => {});
  }, 400);
  return {
    msg,
    stop() { clearInterval(interval); },
  };
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

// ================================
// タイムブロック
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
  const timePart = block.timeRanges.length === 0
    ? "終日"
    : block.timeRanges.map(([s, e]) => `${fmtMin(parseTimeMin(s))}~${fmtMin(parseTimeMin(e))}`).join("、");
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

  for (const id of stageIds)) {
    lines.push(`${id} ${nameMap.get(id) ?? "不明"}`);
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
// チャンク送信
// ================================
async function sendChunked(channel: TextChannel, text: string, lang = ""): Promise<void> {
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
// ハンドラー: スケジュール一覧
// ================================
async function handleSchedule(channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: SaleJson, nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchSaleJson(), fetchNameMap()]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const now = new Date();
  const filtered = json.data.filter(e => {
    if (isPermanent(e)) return false;
    const end = parseHeaderDate(e.header.endDate, e.header.endTime);
    return end > now;
  });

  if (filtered.length === 0) {
    await spinner.msg.edit("開催中・予定のセールイベントはありません");
    return;
  }

  filtered.sort((a, b) =>
    parseHeaderDate(a.header.startDate, a.header.startTime).getTime() -
    parseHeaderDate(b.header.startDate, b.header.startTime).getTime()
  );

  const lines: string[] = [];
  for (const entry of filtered) {
    const validIds = entry.stageIds;
    if (validIds.length === 0) continue;
    const start = parseHeaderDate(entry.header.startDate, entry.header.startTime);
    const end = parseHeaderDate(entry.header.endDate, entry.header.endTime);
    const emoji = isActive(entry, now) ? "🟢" : "🔵";
    lines.push(`${emoji} ${formatDateShort(start)} ~ ${formatDateShort(end)}`);
    for (const id of validIds) {
      lines.push(`    ${id} ${nameMap.get(id) ?? "不明"}`);
    }
    lines.push("");
  }

  await spinner.msg.delete().catch(() => {});
  await sendChunked(channel, `セールスケジュール [開催中＆予定]\n\n` + lines.join("\n"));
}

// ================================
// ハンドラー: 詳細
// ================================
async function handleDetail(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: SaleJson, nameMap: Map<number, string>;
  try {
    [json, nameMap] = await Promise.all([fetchSaleJson(), fetchNameMap()]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  for (const entry of entries) {
    await sendChunked(channel, formatEntryDetail(entry, nameMap));
  }
}

// ================================
// ハンドラー: Raw
// ================================
async function handleRaw(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: SaleJson;
  try {
    json = await fetchSaleJson();
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }
  await spinner.msg.delete().catch(() => {});
  for (const entry of entries) {
    if (!entry.raw) {
      await channel.send(`❌ (startDate: \`${entry.header.startDate}\`) に raw データがありません`);
      continue;
    }
    await sendChunked(channel, entry.raw.replace(/\t/g, "    "));
  }
}

// ================================
// ハンドラー: JSON
// ================================
async function handleJson(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: SaleJson;
  try {
    json = await fetchSaleJson();
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const entries = json.data.filter(e => e.stageIds.includes(id));
  if (entries.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` は sale.json に含まれていません`);
    return;
  }
  await spinner.msg.delete().catch(() => {});
  for (const entry of entries) {
    const { raw: _raw, ...entryData } = entry;
    await sendChunked(channel, JSON.stringify(entryData, null, 2), "json");
  }
}

// ================================
// ハンドラー: 名前検索
// ================================
async function handleSearch(
  query: string,
  message: Message,
  channel: TextChannel
): Promise<void> {
  const spinner = await createSpinner(channel);
  let nameMap: Map<number, string>;
  try {
    nameMap = await fetchNameMap();
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const q = query.toLowerCase();
  const matchedIds = [...nameMap.keys()].filter(id =>
    (nameMap.get(id) ?? "").toLowerCase().includes(q)
  );

  if (matchedIds.length === 0) {
    await spinner.msg.edit(`❌ \`${query}\` に一致するイベントは見つかりませんでした`);
    return;
  }

  await spinner.msg.delete().catch(() => {});

  if (matchedIds.length <= 9) {
    const lines = matchedIds.map((id, i) =>
      `${NUMBER_EMOJIS[i]} ${id} ${nameMap.get(id) ?? "不明"}`
    );
    const resultMsg = await channel.send("```\n" + lines.join("\n") + "\n```");

    for (let i = 0; i < matchedIds.length; i++) {
      await resultMsg.react(NUMBER_EMOJIS[i]);
    }

    const filter = (reaction: MessageReaction, user: User) =>
      NUMBER_EMOJIS.slice(0, matchedIds.length).includes(reaction.emoji.name ?? "") &&
      user.id === message.author.id;

    try {
      const collected = await resultMsg.awaitReactions({ filter, max: 1, time: 30_000, errors: ["time"] });
      const reaction = collected.first();
      if (reaction) {
        const idx = NUMBER_EMOJIS.indexOf(reaction.emoji.name ?? "");
        if (idx !== -1) await handleDetail(matchedIds[idx], channel);
      }
    } catch {
      // 30秒タイムアウト → 何もしない
    }
  } else {
    const lines = matchedIds.map(id => `${id} ${nameMap.get(id) ?? "不明"}`);
    await sendChunked(channel, `「${query}」の検索結果 (${matchedIds.length}件)\n\n` + lines.join("\n"));
  }
}

// ================================
// コマンド本体
// ================================
const sale = {
  name: "sale",
  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      await handleSchedule(channel);
      return;
    }

    const first = args[0];
    const idNum = parseInt(first);
    const isNumeric = !isNaN(idNum) && String(idNum) === first.trim();

    if (isNumeric) {
      const mod = args[1]?.toLowerCase();
      if (mod === "r") await handleRaw(idNum, channel);
      else if (mod === "j" || mod === "json") await handleJson(idNum, channel);
      else await handleDetail(idNum, channel);
      return;
    }

    await handleSearch(args.join(" "), message, channel);
  },
};

<<<<<<< HEAD
module.exports = sale;
=======
module.exports = sale;
>>>>>>> ef4c25d6b13fe084926222a7654c520275e88afa
