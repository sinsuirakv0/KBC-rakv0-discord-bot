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

// gachaType → Mode 対応
const GACHA_TYPE_TO_MODE: Record<number, Mode> = {
  0: "N",
  1: "R",
  2: "N",
  3: "N",
  4: "E",
};

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
    return `https://ponosgames.com/information/appli/battlecats/gacha/rare/R${String(id).padStart(4, "0")}.html`;
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
// ID検索（レアリティ必須）
// ================================
async function handleIdSearch(
  id: number,
  mode: Mode,
  channel: TextChannel
): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");

  const [csv, json] = await Promise.all([
    fetchCsv(csvUrlForMode(mode)).catch(() => null),
    fetchGachaJson().catch(() => null),
  ]);

  if (!csv) {
    await processingMsg.edit("❌ CSVの取得に失敗しました");
    return;
  }

  const name = csv.byId.get(id);
  if (!name) {
    await processingMsg.edit(`❌ [${mode}] ID \`${id}\` は見つかりませんでした`);
    return;
  }

  const active = json ? activeLabel(id, json) : "";
  const pLink = ponosLink(mode, id);
  const jLink = jdbLink(mode, id);

  const embed = new EmbedBuilder()
    .setTitle(`[${mode}] ${id} ${name}${active}`)
    .setColor(0x5865f2)
    .setDescription(`${pLink}\n${jLink}`);

  await processingMsg.delete().catch(() => void 0);
  await channel.send({ embeds: [embed] });
}

// ================================
// 名前検索（モード指定なしで全CSV検索）
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

  // ID ごとの行を生成
  // 同じ名前が複数モードにある場合は別々に表示
  const lines: string[] = [];
  for (const r of results) {
    const idLines = r.ids.map((id) => {
      const active = json ? activeLabel(id, json) : "";
      return `\`[${r.mode}]\` **${id}** ${r.name}${active}`;
    });
    lines.push(...idLines);
  }

  // 1800文字制限でチャンク分割
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > 1800) {
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
          ? `🔍 「${query}」の検索結果 (${lines.length}件)`
          : `🔍 続き`
      )
      .setDescription(chunks[i]);
    await channel.send({ embeds: [embed] });
  }
}

// ================================
// スケジュール表示（変更なし）
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

  const csvR = await fetchCsv(CSV_URL_R).catch(() => null);
  const csvE = await fetchCsv(CSV_URL_E).catch(() => null);
  const csvN = await fetchCsv(CSV_URL_N).catch(() => null);

  const now = new Date();

  const blocks = json.data.filter((block) => {
    const { endDate, endTime } = block.header;
    if (endDate === "20300101") return false;
    const end = parseDate(endDate, endTime);
    return end >= now;
  });

  blocks.sort((a, b) => {
    const sa = parseDate(a.header.startDate, a.header.startTime).getTime();
    const sb = parseDate(b.header.startDate, b.header.startTime).getTime();
    return sa - sb;
  });

  if (blocks.length === 0) {
    await processingMsg.edit("開催中・近日予定のガチャはありません");
    return;
  }

  const embeds: EmbedBuilder[] = [];
  let currentEmbed = new EmbedBuilder()
    .setTitle("ガチャスケジュール")
    .setColor(0xf0a500)
    .setFooter({ text: `更新: ${json.updatedAt}` });
  let fieldCount = 0;

  for (const block of blocks) {
    const { header, gachas } = block;
    const start = parseDate(header.startDate, header.startTime);
    const end = parseDate(header.endDate, header.endTime);
    const isActive = start <= now;
    const blockMode = GACHA_TYPE_TO_MODE[header.gachaType] ?? "R";

    const period = `${formatDate(start)}～${formatDate(end)}`;
    const ver = `ver.${header.minVersion}～${header.maxVersion}`;

    const lines: string[] = [];

    for (const gacha of gachas) {
      let name = "不明";
      if (header.gachaType === 1) name = csvR?.byId.get(gacha.id) ?? "不明";
      else if (header.gachaType === 3) name = csvN?.byId.get(gacha.id) ?? "不明";
      else if (header.gachaType === 4) name = csvE?.byId.get(gacha.id) ?? "不明";
      else name = csvN?.byId.get(gacha.id) ?? "不明";

      const flag = flagLabel(gacha.flags);
      const guaranteed = gacha.guaranteed ? "【確定】" : "";
      const rates = rateStr(gacha.rates);

      lines.push(`・**${gacha.id}** [${blockMode}] ${name} (pos:${header.gachaCount})`);
      lines.push(`レート > ${rates}${guaranteed}${flag ? " " + flag : ""}`);
    }

    const title = `${isActive ? "🟢" : "🔵"} ${period}`;
    const value = `${ver}\n${lines.join("\n")}`;

    if (fieldCount >= 25) {
      embeds.push(currentEmbed);
      currentEmbed = new EmbedBuilder().setColor(0xf0a500);
      fieldCount = 0;
    }

    currentEmbed.addFields({ name: title, value, inline: false });
    fieldCount++;
  }

  embeds.push(currentEmbed);

  await processingMsg.delete().catch(() => void 0);
  for (const embed of embeds) {
    await channel.send({ embeds: [embed] });
  }
}

// ================================
// コマンド本体
// ================================
const gt: Command = {
  name: "gt",
  description: "ガチャ検索・スケジュール表示",
  usage: [
    "o.gt <名前>          : 全レアリティから名前検索",
    "o.gt R|N|E <名前>    : レアリティ指定で名前検索",
    "o.gt R|N|E <番号>    : レアリティ指定でID検索",
    "o.gt s               : ガチャスケジュール表示",
  ].join("\n"),

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      const err = await channel.send(
        [
          "❌ 使い方:",
          "　`o.gt <名前>` — 全レアリティから名前検索",
          "　`o.gt R|N|E <名前>` — レアリティ指定で名前検索",
          "　`o.gt R|N|E <番号>` — レアリティ指定でID検索",
          "　`o.gt s` — スケジュール表示",
        ].join("\n")
      );
      setTimeout(() => err.delete().catch(() => void 0), 12_000);
      return;
    }

    // スケジュール
    if (args[0] === "s") {
      await handleSchedule(channel);
      return;
    }

    const { mode, query } = parseArgs(args);

    if (!query) {
      const err = await channel.send("❌ 検索ワードまたはIDを入力してください");
      setTimeout(() => err.delete().catch(() => void 0), 8_000);
      return;
    }

    const num = parseInt(query);

    // 数値 → ID検索（レアリティ必須）
    if (!isNaN(num) && String(num) === query.trim()) {
      if (!mode) {
        const err = await channel.send(
          "❌ ID検索はレアリティの指定が必要です\n例: `o.gt R 942` / `o.gt N 3` / `o.gt E 47`"
        );
        setTimeout(() => err.delete().catch(() => void 0), 10_000);
        return;
      }
      await handleIdSearch(num, mode, channel);
      return;
    }

    // 文字列 → 名前検索
    await handleNameSearch(query, mode, channel);
  },
};

module.exports = gt;
