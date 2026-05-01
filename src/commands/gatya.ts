import { Message, TextChannel } from "discord.js";

const CSV_URL_R =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/gatya_name.csv";
const CSV_URL_E =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/gatya_e_name.csv";
const CSV_URL_N =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/gatya_n_name.csv";
const JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event/main/data/gatya.json";

const FLAGS_MAP: Record<number, string> = {
  4: "【step up】",
  20600: "＋福引＆かけら",
  16384: "＋かけら",
  4216: "＋福引",
};
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const SPINNER_FRAMES = [
  "- 処理中.",
  "\\ 処理中..",
  "| 処理中...",
  "/ 処理中",
];

type Mode = "R" | "E" | "N";

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
// 型定義
// ================================
interface CsvData {
  byId: Map<number, string>;
}

interface GachaRate {
  normal: number;
  rare: number;
  superRare: number;
  uberRare: number;
  legendRare: number;
}
interface GachaEntry {
  id: number;
  price: number;
  flags: number;
  rates: GachaRate;
  guaranteed: boolean;
  message?: string;
}
interface GachaHeader {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  minVersion: string;
  maxVersion: string;
  gachaType: number;
  gachaCount: number;
}
interface GachaBlock {
  header: GachaHeader;
  gachas: GachaEntry[];
  raw?: string;
}
interface GachaJson {
  updatedAt: string;
  data: GachaBlock[];
}

// ================================
// データ取得
// ================================
async function fetchCsv(url: string): Promise<CsvData> {
  const res = await fetch(url);
  const text = await res.text();
  const byId = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const ci = t.indexOf(",");
    if (ci === -1) continue;
    const id = parseInt(t.slice(0, ci));
    if (!isNaN(id)) byId.set(id, t.slice(ci + 1).trim());
  }
  return { byId };
}

async function fetchGachaJson(): Promise<GachaJson> {
  const res = await fetch(JSON_URL);
  return (await res.json()) as GachaJson;
}

// ================================
// 日付ユーティリティ
// ================================
function parseDate(dateStr: string, timeStr: string): Date {
  const d = dateStr.padStart(8, "0");
  const t = timeStr.padStart(4, "0");
  return new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00+09:00`
  );
}

function formatDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const wd = WEEKDAYS[jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${m}/${d}(${wd}) ${hh}:${mm}`;
}

function flagLabel(flags: number): string {
  return FLAGS_MAP[flags] ?? "";
}

function rateStr(rates: GachaRate): string {
  return [rates.rare, rates.superRare, rates.uberRare, rates.legendRare].join(",");
}

function typeTag(gachaType: number): string {
  if (gachaType === 4) return " <イベント>";
  if (gachaType === 0) return " <ノーマル>";
  return "";
}

function flagShort(flags: number): string {
  const label = FLAGS_MAP[flags];
  return label ? ` ${label}` : "";
}

function modeMatchesType(mode: Mode | null, gachaType: number): boolean {
  if (!mode) return true;
  if (mode === "R") return gachaType === 1;
  if (mode === "E") return gachaType === 4;
  if (mode === "N") return gachaType === 0;
  return true;
}

function getCsvForBlock(gachaType: number, csvR: CsvData, csvE: CsvData, csvN: CsvData): CsvData {
  if (gachaType === 1) return csvR;
  if (gachaType === 4) return csvE;
  return csvN;
}

// ================================
// スケジュールエントリ構築
// ================================
interface ScheduleEntry {
  startDate: Date;
  endDate: Date;
  id: number;
  name: string;
  gachaType: number;
  flags: number;
}

function buildScheduleEntries(
  csvR: CsvData, csvE: CsvData, csvN: CsvData,
  json: GachaJson
): ScheduleEntry[] {
  const now = new Date();
  const entries: ScheduleEntry[] = [];

  for (const block of json.data) {
    const { header, gachas } = block;
    if (header.endDate === "20300101") continue;
    const end = parseDate(header.endDate, header.endTime);
    if (end < now) continue;
    const start = parseDate(header.startDate, header.startTime);

    for (const gacha of gachas) {
      if (gacha.id < 0) continue;
      const csv = getCsvForBlock(header.gachaType, csvR, csvE, csvN);
      const name = csv.byId.get(gacha.id) ?? "不明";
      entries.push({ startDate: start, endDate: end, id: gacha.id, name, gachaType: header.gachaType, flags: gacha.flags });
    }
  }

  entries.sort((a, b) => {
    const ds = a.startDate.getTime() - b.startDate.getTime();
    return ds !== 0 ? ds : a.id - b.id;
  });

  return entries;
}

function formatScheduleText(entries: ScheduleEntry[]): string {
  const now = new Date();
  const lines: string[] = [];
  let lastDateKey = "";
  const seen = new Set<string>();

  for (const e of entries) {
    const key = `${e.startDate.getTime()}-${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const jst = new Date(e.startDate.getTime() + 9 * 60 * 60 * 1000);
    const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const wd = WEEKDAYS[jst.getUTCDay()];
    const dateKey = `${m}/${d}(${wd})`;

    if (dateKey !== lastDateKey) {
      lines.push(e.startDate <= now ? dateKey : `[${dateKey}]`);
      lastDateKey = dateKey;
    }

    lines.push(`  ${String(e.id).padEnd(4)} ${e.name}${typeTag(e.gachaType)}${flagShort(e.flags)}`);
  }

  return lines.join("\n");
}

async function sendChunked(channel: TextChannel, text: string, lang = ""): Promise<void> {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > 1800) { chunks.push(current); current = line; }
    else { current = current ? current + "\n" + line : line; }
  }
  if (current) chunks.push(current);
  const open = lang ? `\`\`\`${lang}\n` : "```\n";
  for (const chunk of chunks) await channel.send(open + chunk + "\n```");
}

// ================================
// ハンドラー: スケジュール一覧
// ================================
async function handleSchedule(channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: GachaJson;
  let csvR: CsvData, csvE: CsvData, csvN: CsvData;
  try {
    [json, csvR, csvE, csvN] = await Promise.all([
      fetchGachaJson(),
      fetchCsv(CSV_URL_R),
      fetchCsv(CSV_URL_E),
      fetchCsv(CSV_URL_N),
    ]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const entries = buildScheduleEntries(csvR, csvE, csvN, json);
  if (entries.length === 0) {
    await spinner.msg.edit("開催中・近日予定のガチャはありません");
    return;
  }

  await spinner.msg.delete().catch(() => {});
  await sendChunked(channel, formatScheduleText(entries));
}

// ================================
// ハンドラー: ID詳細
// ================================
async function handleIdDetail(id: number, mode: Mode | null, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: GachaJson;
  let csvR: CsvData, csvE: CsvData, csvN: CsvData;
  try {
    [json, csvR, csvE, csvN] = await Promise.all([
      fetchGachaJson(),
      fetchCsv(CSV_URL_R),
      fetchCsv(CSV_URL_E),
      fetchCsv(CSV_URL_N),
    ]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const blocks = json.data.filter(
    b => modeMatchesType(mode, b.header.gachaType) && b.gachas.some(g => g.id === id)
  );
  if (blocks.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await spinner.msg.delete().catch(() => {});

  for (const block of blocks) {
    const { header } = block;
    const gacha = block.gachas.find(g => g.id === id)!;
    const isPerm = header.endDate === "20300101";
    const start = parseDate(header.startDate, header.startTime);
    const end = isPerm ? null : parseDate(header.endDate, header.endTime);
    const csv = getCsvForBlock(header.gachaType, csvR, csvE, csvN);
    const name = csv.byId.get(id) ?? "不明";

    const period = isPerm
      ? `${formatDate(start)} ～ 常設`
      : `${formatDate(start)} ～ ${formatDate(end!)}`;
    const flagStr = flagLabel(gacha.flags) ? " " + flagLabel(gacha.flags) : "";
    const guaranteedStr = gacha.guaranteed ? " 【確定】" : "";

    const lines = [
      `${period}  ver.${header.minVersion}～${header.maxVersion}`,
      ` ${id} ${name}${flagStr}${guaranteedStr}${typeTag(header.gachaType)}`,
      `レート: ${rateStr(gacha.rates)}`,
    ];
    if (gacha.message) lines.push(`メッセージ: ${gacha.message}`);

    await channel.send("```\n" + lines.join("\n") + "\n```");
  }
}

// ================================
// ハンドラー: 名前検索
// ================================
async function handleSearch(query: string, mode: Mode | null, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: GachaJson;
  let csvR: CsvData, csvE: CsvData, csvN: CsvData;
  try {
    [json, csvR, csvE, csvN] = await Promise.all([
      fetchGachaJson(),
      fetchCsv(CSV_URL_R),
      fetchCsv(CSV_URL_E),
      fetchCsv(CSV_URL_N),
    ]);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const entries = buildScheduleEntries(csvR, csvE, csvN, json);
  const matched = entries.filter(
    e => modeMatchesType(mode, e.gachaType) && e.name.toLowerCase().includes(query.toLowerCase())
  );

  if (matched.length === 0) {
    await spinner.msg.edit(`❌ スケジュール内に \`${query}\` は見つかりませんでした`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  await sendChunked(channel, formatScheduleText(matched));
}

// ================================
// ハンドラー: JSON
// ================================
async function handleJson(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const blocks = json.data.filter(b => b.gachas.some(g => g.id === id));
  if (blocks.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  for (const block of blocks) {
    const { raw: _raw, ...blockData } = block;
    await sendChunked(channel, JSON.stringify(blockData, null, 2), "json");
  }
}

// ================================
// ハンドラー: Raw
// ================================
async function handleRaw(id: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ データ取得に失敗しました");
    return;
  }
  spinner.stop();

  const blocks = json.data.filter(b => b.gachas.some(g => g.id === id));
  if (blocks.length === 0) {
    await spinner.msg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await spinner.msg.delete().catch(() => {});
  for (const block of blocks) {
    if (!block.raw) {
      await channel.send(`❌ (startDate: ${block.header.startDate}) に raw データがありません`);
      continue;
    }
    await sendChunked(channel, block.raw.replace(/\t/g, "    "));
  }
}

// ================================
// コマンド本体
// ================================
const gatya = {
  name: "gatya",
  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      await handleSchedule(channel);
      return;
    }

    // モード解析
    const firstUpper = args[0].toUpperCase();
    let mode: Mode | null = null;
    let rest = args;
    if (firstUpper === "R" || firstUpper === "N" || firstUpper === "E") {
      mode = firstUpper as Mode;
      rest = args.slice(1);
    }

    if (rest.length === 0) {
      await handleSchedule(channel);
      return;
    }

    const last = rest[rest.length - 1].toLowerCase();
    const idStr = rest[rest.length - 2];

    // <ID> j → JSON
    if ((last === "j" || last === "json") && rest.length >= 2) {
      const idNum = parseInt(idStr);
      if (!isNaN(idNum) && String(idNum) === idStr) {
        await handleJson(idNum, channel);
        return;
      }
    }

    // <ID> r → Raw
    if (last === "r" && rest.length >= 2) {
      const idNum = parseInt(idStr);
      if (!isNaN(idNum) && String(idNum) === idStr) {
        await handleRaw(idNum, channel);
        return;
      }
    }

    const query = rest.join(" ");
    const num = parseInt(query);

    // 数値 → ID詳細
    if (!isNaN(num) && String(num) === query.trim()) {
      await handleIdDetail(num, mode, channel);
      return;
    }

    // 文字列 → 名前検索
    await handleSearch(query, mode, channel);
  },
};

module.exports = gatya;