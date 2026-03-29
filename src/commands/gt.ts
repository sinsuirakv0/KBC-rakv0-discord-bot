import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";

// ================================
// CSV URL（R / E / N）
// ================================
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

// gachaType → Mode 対応（2/3は無視）
function gachaTypeToMode(gachaType: number): Mode {
  if (gachaType === 1) return "R";
  if (gachaType === 4) return "E";
  return "N";
}

// ================================
// CSV パース
// ================================
interface CsvData {
  byId: Map<number, string>;
  byName: Map<string, number[]>;
  rawNames: Map<string, string>;
}

async function fetchCsv(url: string): Promise<CsvData> {
  const res = await fetch(url);
  const text = await res.text();
  const byId = new Map<number, string>();
  const byName = new Map<string, number[]>();
  const rawNames = new Map<string, string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const commaIdx = trimmed.indexOf(",");
    if (commaIdx === -1) continue;
    const id = parseInt(trimmed.slice(0, commaIdx));
    const name = trimmed.slice(commaIdx + 1).trim();
    if (isNaN(id)) continue;

    byId.set(id, name);
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(id);
    rawNames.set(key, name);
  }

  return { byId, byName, rawNames };
}

// ================================
// JSON パース
// ================================
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

// ================================
// モード
// ================================
type Mode = "R" | "E" | "N";

function csvUrlForMode(mode: Mode): string {
  if (mode === "E") return CSV_URL_E;
  if (mode === "N") return CSV_URL_N;
  return CSV_URL_R;
}

// ================================
// リンク生成
// ================================
function ponosLink(mode: Mode, id: number): string {
  if (mode === "R") {
    return `https://ponosgames.com/information/appli/battlecats/gacha/rare/R${String(id).padStart(3, "0")}.html`;
  }
  if (mode === "N") {
    return `https://ponosgames.com/information/appli/battlecats/gacha/normal/N${String(id).padStart(3, "0")}.html`;
  }
  return `https://ponosgames.com/information/appli/battlecats/gacha/event/E${String(id).padStart(3, "0")}.html`;
}

function jdbLink(mode: Mode, id: number): string {
  return `https://jarjarblink.github.io/JDB/gatya.html?cc=ja&rare=${mode}&no=${id}`;
}

// ================================
// 開催中チェック
// ================================
function isCurrentlyActive(id: number, json: GachaJson): boolean {
  const now = new Date();
  return json.data.some((block) => {
    const start = parseDate(block.header.startDate, block.header.startTime);
    const end = parseDate(block.header.endDate, block.header.endTime);
    return block.gachas.some((g) => g.id === id) && start <= now && end >= now;
  });
}

// 常設かどうか（endDate が 20300101 のブロックにのみ存在する場合）
function isPermanent(id: number, json: GachaJson): boolean {
  const blocks = json.data.filter((b) => b.gachas.some((g) => g.id === id));
  return blocks.length > 0 && blocks.every((b) => b.header.endDate === "20300101");
}

function activeLabel(id: number, json: GachaJson): string {
  if (isCurrentlyActive(id, json)) return " 🟢開催中";
  if (isPermanent(id, json)) return " 🔒常設";
  return "";
}

// ================================
// 引数パース
// ================================
function parseArgs(args: string[]): { mode: Mode | null; query: string } {
  if (args.length === 0) return { mode: null, query: "" };

  const first = args[0].toUpperCase();
  if (first === "R" || first === "N" || first === "E") {
    return { mode: first as Mode, query: args.slice(1).join(" ") };
  }

  return { mode: null, query: args.join(" ") };
}

// ================================
// ID検索（レアリティ未指定なら全CSV検索）
// ================================
async function handleIdSearch(
  id: number,
  mode: Mode | null,
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  const modesToSearch: Mode[] = mode ? [mode] : ["R", "N", "E"];

  const [csvEntries, json] = await Promise.all([
    Promise.all(
      modesToSearch.map((m) =>
        fetchCsv(csvUrlForMode(m))
          .then((csv) => ({ mode: m, csv }))
          .catch(() => null)
      )
    ),
    fetchGachaJson().catch(() => null),
  ]);

  const found: { mode: Mode; name: string }[] = [];
  for (const entry of csvEntries) {
    if (!entry) continue;
    const name = entry.csv.byId.get(id);
    if (name) found.push({ mode: entry.mode, name });
  }

  if (found.length === 0) {
    const label = mode ? `[${mode}] ` : "";
    await processingMsg.edit(`❌ ${label}ID \`${id}\` は見つかりませんでした`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const { mode: m, name } of found) {
    const active = json ? activeLabel(id, json) : "";
    const pLink = ponosLink(m, id);
    const jLink = jdbLink(m, id);

    const embed = new EmbedBuilder()
      .setTitle(`[${m}] ${id} ${name}${active}`)
      .setColor(0x5865f2)
      .setDescription(`${pLink}\n${jLink}`);

    await channel.send({ embeds: [embed] });
  }
}

// ================================
// 名前検索（モード指定なしで全CSV検索、同名グループ化）
// ================================
interface SearchResult {
  mode: Mode;
  name: string;
  ids: number[];
}

async function handleNameSearch(
  query: string,
  mode: Mode | null,
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  const q = query.toLowerCase();
  const modesToSearch: Mode[] = mode ? [mode] : ["R", "N", "E"];

  // CSV と JSON を並列取得
  const [csvs, json] = await Promise.all([
    Promise.all(
      modesToSearch.map((m) =>
        fetchCsv(csvUrlForMode(m))
          .then((csv) => ({ mode: m, csv }))
          .catch(() => null)
      )
    ),
    fetchGachaJson().catch(() => null),
  ]);

  const results: SearchResult[] = [];

  for (const entry of csvs) {
    if (!entry) continue;
    const { mode: m, csv } = entry;

    for (const [key, ids] of csv.byName) {
      if (key.includes(q)) {
        results.push({ mode: m, name: csv.rawNames.get(key) ?? key, ids });
      }
    }
  }

  if (results.length === 0) {
    await processingMsg.edit(`❌ \`${query}\` に一致するガチャは見つかりませんでした`);
    return;
  }

  // 同名グループ化: "name|mode" をキーにまとめる
  const grouped = new Map<string, SearchResult>();
  for (const r of results) {
    const key = `${r.mode}|${r.name}`;
    if (!grouped.has(key)) {
      grouped.set(key, { mode: r.mode, name: r.name, ids: [] });
    }
    grouped.get(key)!.ids.push(...r.ids);
  }

  // グループごとに「名前ヘッダー + ID一覧」の形式で行を作る
  const lines: string[] = [];
  const totalIds = Array.from(grouped.values()).reduce((acc, r) => acc + r.ids.length, 0);

  for (const r of grouped.values()) {
    // グループヘッダー
    lines.push(`**[${r.mode}] ${r.name}**`);
    // ID一覧（開催中ラベル付き）
    const idParts = r.ids.map((id) => {
      const active = json ? activeLabel(id, json) : "";
      return `${id}${active}`;
    });
    lines.push(idParts.join("　"));
    lines.push(""); // 空行で区切り
  }

  // 1800文字制限でチャンク分割
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > 1800) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);

  await processingMsg.delete().catch(() => void 0);

  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(
        i === 0
          ? `🔍 「${query}」の検索結果 (${totalIds}件)`
          : `🔍 続き`
      )
      .setDescription(chunks[i]);
    await channel.send({ embeds: [embed] });
  }
}

// ================================
// スケジュール表示ユーティリティ
// ================================
function typeTag(gachaType: number): string {
  if (gachaType === 4) return " <イベント>";
  if (gachaType === 0) return " <ノーマル>";
  return "";
}

function flagShort(flags: number): string {
  const label = FLAGS_MAP[flags];
  return label ? ` ${label}` : "";
}

interface ScheduleEntry {
  startDate: Date;
  endDate: Date;
  id: number;
  name: string;
  gachaType: number;
  flags: number;
}

async function buildScheduleEntries(
  csvR: CsvData | null,
  csvE: CsvData | null,
  csvN: CsvData | null,
  json: GachaJson
): Promise<ScheduleEntry[]> {
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

      let name = "不明";
      if (header.gachaType === 1) name = csvR?.byId.get(gacha.id) ?? "不明";
      else if (header.gachaType === 4) name = csvE?.byId.get(gacha.id) ?? "不明";
      else name = csvN?.byId.get(gacha.id) ?? "不明";

      entries.push({ startDate: start, endDate: end, id: gacha.id, name, gachaType: header.gachaType, flags: gacha.flags });
    }
  }

  // startDate 昇順 → 同 startDate 内は id 昇順
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

  // 重複行を避けるため (startDate, id) ペアを追跡
  const seen = new Set<string>();

  for (const e of entries) {
    const key = `${e.startDate.getTime()}-${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // 日付ヘッダー
    const jst = new Date(e.startDate.getTime() + 9 * 60 * 60 * 1000);
    const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(jst.getUTCDate()).padStart(2, "0");
    const wd = WEEKDAYS[jst.getUTCDay()];
    const dateKey = `${m}/${d}(${wd})`;

    if (dateKey !== lastDateKey) {
      const isStarted = e.startDate <= now;
      lines.push(isStarted ? dateKey : `[${dateKey}]`);
      lastDateKey = dateKey;
    }

    const tag = typeTag(e.gachaType);
    const flag = flagShort(e.flags);
    lines.push(`  ${String(e.id).padEnd(4)} ${e.name}${tag}${flag}`);
  }

  return lines.join("\n");
}

// ================================
// スケジュール全体表示
// ================================
async function handleSchedule(channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ ガチャスケジュールを取得中...");

  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const [csvR, csvE, csvN] = await Promise.all([
    fetchCsv(CSV_URL_R).catch(() => null),
    fetchCsv(CSV_URL_E).catch(() => null),
    fetchCsv(CSV_URL_N).catch(() => null),
  ]);

  const entries = await buildScheduleEntries(csvR, csvE, csvN, json);
  if (entries.length === 0) {
    await processingMsg.edit("開催中・近日予定のガチャはありません");
    return;
  }

  const fullText = formatScheduleText(entries);

  // 1800文字でコードブロックチャンク分割
  const rawLines = fullText.split("\n");
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

  await processingMsg.delete().catch(() => void 0);
  for (const chunk of chunks) {
    await channel.send("```\n" + chunk + "\n```");
  }
}

// ================================
// スケジュール内 ID詳細検索
// ================================
function getCsvForBlock(gachaType: number, csvR: CsvData | null, csvE: CsvData | null, csvN: CsvData | null): CsvData | null {
  if (gachaType === 1) return csvR;
  if (gachaType === 4) return csvE;
  return csvN;
}

function formatGachaTypeLabel(gachaType: number): string {
  if (gachaType === 4) return " (イベントガチャ)";
  if (gachaType === 0) return " (ノーマルガチャ)";
  return "";
}

async function handleScheduleIdDetail(
  id: number,
  mode: Mode | null,
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const [csvR, csvE, csvN] = await Promise.all([
    fetchCsv(CSV_URL_R).catch(() => null),
    fetchCsv(CSV_URL_E).catch(() => null),
    fetchCsv(CSV_URL_N).catch(() => null),
  ]);

  // mode 指定があれば gachaType でフィルター
  const modeMatchesType = (gachaType: number): boolean => {
    if (!mode) return true;
    if (mode === "R") return gachaType === 1;
    if (mode === "E") return gachaType === 4;
    if (mode === "N") return gachaType === 0;
    return true;
  };

  const blocks = json.data.filter(
    (block) => modeMatchesType(block.header.gachaType) && block.gachas.some((g) => g.id === id)
  );

  if (blocks.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const block of blocks) {
    const { header } = block;
    const gacha = block.gachas.find((g) => g.id === id)!;
    const isPerm = header.endDate === "20300101";
    const start = parseDate(header.startDate, header.startTime);
    const end = isPerm ? null : parseDate(header.endDate, header.endTime);

    const csv = getCsvForBlock(header.gachaType, csvR, csvE, csvN);
    const name = csv?.byId.get(id) ?? "不明";

    const period = isPerm
      ? `${formatDate(start)} ～ 常設`
      : `${formatDate(start)} ～ ${formatDate(end!)}`;
    const ver = `ver.${header.minVersion}～${header.maxVersion}`;
    const flagStr = flagLabel(gacha.flags) ? " " + flagLabel(gacha.flags) : "";
    const guaranteedStr = gacha.guaranteed ? " 【確定】" : "";
    const typeStr = formatGachaTypeLabel(header.gachaType);

    const lines: string[] = [
      `${period}  ${ver}`,
      ` ${id} ${name}${flagStr}${guaranteedStr}${typeStr}`,
      `レート: ${rateStr(gacha.rates)}`,
    ];
    if (gacha.message) lines.push(`メッセージ: ${gacha.message}`);

    await channel.send("```\n" + lines.join("\n") + "\n```");
  }
}

// ================================
// スケジュール内 名前検索
// ================================
async function handleScheduleSearch(
  query: string,
  mode: Mode | null,
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const [csvR, csvE, csvN] = await Promise.all([
    fetchCsv(CSV_URL_R).catch(() => null),
    fetchCsv(CSV_URL_E).catch(() => null),
    fetchCsv(CSV_URL_N).catch(() => null),
  ]);

  const allEntries = await buildScheduleEntries(csvR, csvE, csvN, json);

  const modeMatchesType = (gachaType: number): boolean => {
    if (!mode) return true;
    if (mode === "R") return gachaType === 1;
    if (mode === "E") return gachaType === 4;
    if (mode === "N") return gachaType === 0;
    return true;
  };

  const matched = allEntries.filter(
    (e) => modeMatchesType(e.gachaType) && e.name.toLowerCase().includes(query.toLowerCase())
  );

  if (matched.length === 0) {
    await processingMsg.edit(`❌ スケジュール内に \`${query}\` は見つかりませんでした`);
    return;
  }

  const text = formatScheduleText(matched);
  await processingMsg.delete().catch(() => void 0);
  await channel.send("```\n" + text + "\n```");
}

// ================================
// スケジュール JSON表示
// ================================
async function handleScheduleJson(id: number, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ JSONを取得中...");

  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const blocks = json.data.filter((b) => b.gachas.some((g) => g.id === id));
  if (blocks.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const block of blocks) {
    // raw フィールドを除いて表示
    const { raw: _raw, ...blockData } = block;
    const formatted = JSON.stringify(blockData, null, 2);
    // 1900文字でチャンク分割
    const lines2 = formatted.split("\n");
    const chunks2: string[] = [];
    let cur = "";
    for (const ln of lines2) {
      const add = cur ? "\n" + ln : ln;
      if ((cur + add).length > 1900) { chunks2.push(cur); cur = ln; }
      else { cur = cur ? cur + "\n" + ln : ln; }
    }
    if (cur) chunks2.push(cur);
    for (const c of chunks2) await channel.send("```json\n" + c + "\n```");
  }
}

// ================================
// スケジュール Raw表示
// ================================
async function handleScheduleRaw(id: number, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ JSONを取得中...");

  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const blocks = json.data.filter((b) => b.gachas.some((g) => g.id === id));
  if (blocks.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);

  for (const block of blocks) {
    if (!block.raw) {
      await channel.send(`❌ (startDate: ${block.header.startDate}) に raw データがありません`);
      continue;
    }
    const formatted = block.raw.replace(/\t/g, "    ");
    await channel.send("```\n" + formatted + "\n```");
  }
}

// ================================
// コマンド本体
// ================================
const gt: Command = {
  name: "gt",
  description: "ガチャ検索・スケジュール表示",
  usage: [
    "o.gt <名前>                    : 全レアリティから名前検索",
    "o.gt R|N|E <名前>              : レアリティ指定で名前検索",
    "o.gt <番号>                    : 全レアリティからID検索",
    "o.gt R|N|E <番号>              : レアリティ指定でID検索",
    "o.gt s                         : ガチャスケジュール一覧",
    "o.gt s [R|N|E] <番号>          : スケジュール内ID詳細",
    "o.gt s [R|N|E] <名前>          : スケジュール内名前検索",
    "o.gt s <番号> j|json           : JSON表示",
    "o.gt s <番号> r                : Raw表示",
  ].join("\n"),

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      const err = await channel.send(
        [
          "❌ 使い方:",
          "　`o.gt <名前>` — 全レアリティから名前検索",
          "　`o.gt R|N|E <名前>` — レアリティ指定で名前検索",
          "　`o.gt <番号>` — 全レアリティからID検索",
          "　`o.gt R|N|E <番号>` — レアリティ指定でID検索",
          "　`o.gt s` — スケジュール一覧",
          "　`o.gt s [R|N|E] <番号>` — スケジュール内ID詳細",
          "　`o.gt s [R|N|E] <名前>` — スケジュール内名前検索",
          "　`o.gt s <番号> j` — JSON表示 / `r` — Raw表示",
        ].join("\n")
      );
      setTimeout(() => err.delete().catch(() => void 0), 12_000);
      return;
    }

    // スケジュール
    if (args[0] === "s") {
      const rest = args.slice(1);

      if (rest.length === 0) {
        // o.gt s
        await handleSchedule(channel);
        return;
      }

      // o.gt s <id> j / json → JSON表示
      const last = rest[rest.length - 1].toLowerCase();
      if ((last === "j" || last === "json") && rest.length >= 2) {
        const idStr = rest[rest.length - 2];
        const idNum = parseInt(idStr);
        if (!isNaN(idNum) && String(idNum) === idStr) {
          await handleScheduleJson(idNum, channel);
          return;
        }
      }

      // o.gt s <id> r → Raw表示
      if (last === "r" && rest.length >= 2) {
        const idStr = rest[rest.length - 2];
        const idNum = parseInt(idStr);
        if (!isNaN(idNum) && String(idNum) === idStr) {
          await handleScheduleRaw(idNum, channel);
          return;
        }
      }

      // モード解析
      const firstUpper = rest[0].toUpperCase();
      let schedMode: Mode | null = null;
      let queryArgs = rest;
      if (firstUpper === "R" || firstUpper === "N" || firstUpper === "E") {
        schedMode = firstUpper as Mode;
        queryArgs = rest.slice(1);
      }

      if (queryArgs.length === 0) {
        await handleSchedule(channel);
        return;
      }

      const schedQuery = queryArgs.join(" ");
      const schedNum = parseInt(schedQuery);

      // o.gt s [mode] <id> → ID詳細
      if (!isNaN(schedNum) && String(schedNum) === schedQuery.trim()) {
        await handleScheduleIdDetail(schedNum, schedMode, channel);
        return;
      }

      // o.gt s [mode] <name> → 名前検索（スケジュール形式）
      await handleScheduleSearch(schedQuery, schedMode, channel);
      return;
    }

    const { mode, query } = parseArgs(args);

    if (!query) {
      const err = await channel.send("❌ 検索ワードまたはIDを入力してください");
      setTimeout(() => err.delete().catch(() => void 0), 8_000);
      return;
    }

    const num = parseInt(query);

    // 数値 → ID検索（レアリティ未指定なら全CSV）
    if (!isNaN(num) && String(num) === query.trim()) {
      await handleIdSearch(num, mode, channel);
      return;
    }

    // 文字列 → 名前検索
    await handleNameSearch(query, mode, channel);
  },
};

module.exports = gt;
