import { EmbedBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";

const CSV_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-test/main/data/gatya_name.csv";
const JSON_URL =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-test/main/data/gatya.json";

const FLAGS_MAP: Record<number, string> = {
  4:     "【step up】",
  20600: "＋福引＆かけら",
  16384: "＋かけら",
  4216:  "＋福引",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// ============================================================
// CSV パース: { id -> name, name -> id[] }
// ============================================================
interface CsvData {
  byId: Map<number, string>;
  byName: Map<string, number[]>; // 正規化名 -> id[]
  rawNames: Map<string, string>;  // 正規化名 -> 表示名
}

async function fetchCsv(): Promise<CsvData> {
  const res = await fetch(CSV_URL);
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

// ============================================================
// JSON パース
// ============================================================
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
}
interface GachaJson {
  updatedAt: string;
  data: GachaBlock[];
}

async function fetchGachaJson(): Promise<GachaJson> {
  const res = await fetch(JSON_URL);
  return (await res.json()) as GachaJson;
}

// ============================================================
// 日付ユーティリティ
// ============================================================
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

// ============================================================
// o.gt s — 開催中＆近日予定
// ============================================================
async function handleSchedule(message: Message, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ ガチャスケジュールを取得中...");
  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const csv = await fetchCsv().catch(() => null);
  const now = new Date();

  const blocks = json.data.filter((block) => {
    const { endDate, endTime } = block.header;
    if (endDate === "20300101") return false; // 常設除外
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

  // 25フィールド上限に対応してEmbedを複数に分割
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
      const name = csv?.byId.get(gacha.id) ?? "不明";
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

// ============================================================
// o.gt <検索> — 名前 or 番号検索
// ============================================================
async function handleSearch(query: string, message: Message, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ 検索中...");
  let csv: CsvData;
  try {
    csv = await fetchCsv();
  } catch {
    await processingMsg.edit("❌ CSVの取得に失敗しました");
    return;
  }

  const num = parseInt(query);

  if (!isNaN(num)) {
    // 数字検索
    const name = csv.byId.get(num);
    if (!name) {
      await processingMsg.edit(`❌ ID \`${num}\` は見つかりませんでした`);
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle(`🔍 ${num} ${name}`)
      .setColor(0x5865f2)
      .setDescription(
        `https://jarjarblink.github.io/JDB/gatya.html?cc=ja&rare=R&no=${num}\nhttps://ponosgames.com/information/appli/battlecats/gacha/rare/R${num}.html`
      );
    await processingMsg.delete().catch(() => void 0);
    await channel.send({ embeds: [embed] });
  } else {
    // 名前検索（部分一致）
    const q = query.toLowerCase();
    const results: { name: string; ids: number[] }[] = [];

    for (const [key, ids] of csv.byName) {
      if (key.includes(q)) {
        results.push({ name: csv.rawNames.get(key) ?? key, ids });
      }
    }

    if (results.length === 0) {
      await processingMsg.edit(`❌ \`${query}\` に一致するガチャは見つかりませんでした`);
      return;
    }

    const lines = results.map((r) => `・${r.name}\n${r.ids.join(",")}`);
    // Discordの2000文字制限に対応して分割
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
        .setTitle(i === 0 ? `🔍 「${query}」の検索結果 (${results.length}件)` : `🔍 続き`)
        .setDescription(chunks[i]);
      await channel.send({ embeds: [embed] });
    }
  }
}

// ============================================================
// o.gt <id> json — 該当ガチャのJSONブロックを返す
// ============================================================
async function handleJson(id: number, message: Message, channel: TextChannel): Promise<void> {
  const processingMsg = await channel.send("⏳ JSONを取得中...");
  let json: GachaJson;
  try {
    json = await fetchGachaJson();
  } catch {
    await processingMsg.edit("❌ JSONの取得に失敗しました");
    return;
  }

  const matched = json.data.filter((block) =>
    block.gachas.some((g) => g.id === id)
  );

  if (matched.length === 0) {
    await processingMsg.edit(`❌ ID \`${id}\` を含むガチャブロックは見つかりませんでした`);
    return;
  }

  await processingMsg.delete().catch(() => void 0);
  for (const block of matched) {
    const text = JSON.stringify(block, null, 2);
    if (text.length > 1900) {
      const buf = Buffer.from(text, "utf8");
      const { AttachmentBuilder } = await import("discord.js");
      const file = new AttachmentBuilder(buf, { name: `gacha_${id}.json` });
      await channel.send({ files: [file] });
    } else {
      await channel.send(`\`\`\`json\n${text}\n\`\`\``);
    }
  }
}

// ============================================================
// コマンド本体
// ============================================================
const gt: Command = {
  name: "gt",
  description: "ガチャ検索・スケジュール表示",
  usage: "o.gt <名前or番号>  /  o.gt s  /  o.gt <番号> json",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    if (args.length === 0) {
      const err = await channel.send(
        "❌ 使い方: `o.gt <名前or番号>` / `o.gt s` / `o.gt <番号> json`"
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    if (args[0] === "s") {
      await handleSchedule(message, channel);
      return;
    }

    const num = parseInt(args[0]);
    if (!isNaN(num) && args[1]?.toLowerCase() === "json") {
      await handleJson(num, message, channel);
      return;
    }

    await handleSearch(args.join(" "), message, channel);
  },
};

module.exports = gt;
