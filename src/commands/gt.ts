import { EmbedBuilder, Message, TextChannel, AttachmentBuilder } from "discord.js";
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
  raw?: string; // ← raw は block 直下にある
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
// モード判定（R / E / N）
// ================================
type Mode = "R" | "E" | "N";

function detectModeAndQuery(args: string[]): { mode: Mode; query: string; raw: boolean } {
  // raw は最優先
  if (args.length >= 2 && args[1].toLowerCase() === "r") {
    return { mode: "R", query: args[0], raw: true };
  }

  // ID検索モード（左側）
  if (args.length >= 2) {
    const m = args[0].toLowerCase();
    if (m === "e") return { mode: "E", query: args[1], raw: false };
    if (m === "n") return { mode: "N", query: args[1], raw: false };
  }

  return { mode: "R", query: args.join(" "), raw: false };
}

function csvUrlForMode(mode: Mode): string {
  if (mode === "E") return CSV_URL_E;
  if (mode === "N") return CSV_URL_N;
  return CSV_URL_R;
}

// ================================
// 名前検索 fallback
// ================================
const fallbackOrder: Record<Mode, Mode[]> = {
  R: ["R"],
  E: ["E", "N", "R"],
  N: ["N", "E", "R"],
};

// ================================
// o.gt <ID> r — raw 表示（block.raw）
// ================================
async function handleRaw(id: number, message: Message, channel: TextChannel) {
  const processingMsg = await channel.send("⏳ JSONを取得中...");
  let json: GachaJson;

  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const block = json.data.find((b) => b.gachas.some((g) => g.id === id));
  if (!block) {
    await processingMsg.edit(`❌ ID \`${id}\` はガチャjsonに含まれていません`);
    return;
  }

  // raw は block.raw にある
  if (block.raw == null) {
    await processingMsg.edit("❌ raw データがありません");
    return;
  }

  const formatted = block.raw.replace(/\t/g, "    ");

  await processingMsg.delete().catch(() => void 0);
  await channel.send(`\`\`\`\n${formatted}\n\`\`\``);
}

// ================================
// o.gt <ID> — ID検索
// ================================
async function handleIdSearch(id: number, mode: Mode, message: Message, channel: TextChannel) {
  const processingMsg = await channel.send("⏳ 検索中...");

  const csv = await fetchCsv(csvUrlForMode(mode)).catch(() => null);
  if (!csv) {
    await processingMsg.edit("❌ CSVの取得に失敗しました");
    return;
  }

  const name = csv.byId.get(id);
  if (!name) {
    await processingMsg.edit(`❌ ID \`${id}\` は見つかりませんでした`);
    return;
  }

  const rare = mode;
  const ponosId = String(id).padStart(3, "0");

  const embed = new EmbedBuilder()
    .setTitle(`🔍 ${id} ${name}`)
    .setColor(0x5865f2)
    .setDescription(
      `https://jarjarblink.github.io/JDB/gatya.html?cc=ja&rare=${rare}&no=${id}\n` +
        `https://ponosgames.com/information/appli/battlecats/gacha/rare/${rare}${ponosId}.html`
    );

  await processingMsg.delete().catch(() => void 0);
  await channel.send({ embeds: [embed] });
}

// ================================
// o.gt <名前> — 名前検索（fallback対応）
// ================================
async function handleNameSearch(query: string, mode: Mode, message: Message, channel: TextChannel) {
  const processingMsg = await channel.send("⏳ 検索中...");

  const q = query.toLowerCase();
  const order = fallbackOrder[mode];

  for (const m of order) {
    const csv = await fetchCsv(csvUrlForMode(m)).catch(() => null);
    if (!csv) continue;

    const results: { name: string; ids: number[] }[] = [];

    for (const [key, ids] of csv.byName) {
      if (key.includes(q)) {
        results.push({ name: csv.rawNames.get(key) ?? key, ids });
      }
    }

    if (results.length > 0) {
      if (m !== mode) {
        await processingMsg.delete().catch(() => void 0);
        await channel.send(
          `🔎 **${mode} には見つからなかったため、${order.join(" → ")} の順に探索しました。**\n` +
            `➡ **${m} に見つかりました。**`
        );
      }

      const lines = results.map((r) => `・${r.name}\n${r.ids.join(",")}`);

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

      for (let i = 0; i < chunks.length; i++) {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(i === 0 ? `🔍 「${query}」の検索結果 (${results.length}件)` : `🔍 続き`)
          .setDescription(chunks[i]);
        await channel.send({ embeds: [embed] });
      }

      return;
    }
  }

  await processingMsg.edit(`❌ \`${query}\` に一致するガチャは見つかりませんでした`);
}

// ================================
// o.gt s — スケジュール表示（CSV切替対応）
// ================================
async function handleSchedule(message: Message, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ ガチャスケジュールを取得中...");
  let json: GachaJson;

  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  // R/E/N の CSV を全部ロード
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

    const period = `${formatDate(start)}～${formatDate(end)}`;
    const ver = `ver.${header.minVersion}～${header.maxVersion}`;

    const lines: string[] = [];

    for (const gacha of gachas) {
      let name = "不明";

      if (header.gachaType === 1) name = csvR?.byId.get(gacha.id) ?? "不明";
      if (header.gachaType === 3) name = csvN?.byId.get(gacha.id) ?? "不明";
      if (header.gachaType === 4) name = csvE?.byId.get(gacha.id) ?? "不明";

      const flag = flagLabel(gacha.flags);
      const guaranteed = gacha.guaranteed ? "【確定】" : "";
      const rates = rateStr(gacha.rates);

      lines.push(`・**${gacha.id}** ${name} (pos:${header.gachaCount})`);
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
  usage: "o.gt <名前or番号>  /  o.gt s  /  o.gt <番号> json / o.gt <番号> r",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      const err = await channel.send(
        "❌ 使い方: `o.gt <名前or番号>` / `o.gt s` / `o.gt <番号> json` / `o.gt <番号> r`"
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    if (args[0] === "s") {
      await handleSchedule(message, channel);
      return;
    }

    const { mode, query, raw } = detectModeAndQuery(args);

    const num = parseInt(query);

    if (!isNaN(num)) {
      if (raw) {
        await handleRaw(num, message, channel);
        return;
      }
      await handleIdSearch(num, mode, message, channel);
      return;
    }

    await handleNameSearch(query, mode, message, channel);
  },
};

module.exports = gt;