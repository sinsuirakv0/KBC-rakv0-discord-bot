import crypto from "crypto";
import http from "http";
import { Client, EmbedBuilder, TextChannel } from "discord.js";

const PORT = parseInt(process.env.WEBHOOK_PORT ?? "3000");
const SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const TARGET_FILE = "data/gatya.json";
const CSV_URL = "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-test/main/data/gatya_name.csv";

async function fetchNameMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(CSV_URL);
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const commaIdx = trimmed.indexOf(",");
      if (commaIdx === -1) continue;
      const id = parseInt(trimmed.slice(0, commaIdx));
      const name = trimmed.slice(commaIdx + 1).trim();
      if (!isNaN(id)) map.set(id, name);
    }
  } catch (err) {
    console.error("[webhook] CSV取得エラー:", err);
  }
  return map;
}

const FLAGS_MAP: Record<number, string> = {
  4:     "【step up】",
  20600: "＋福引＆かけら",
  16384: "＋かけら",
  4216:  "＋福引",
};
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

interface GachaEntry {
  id: number;
  flags: number;
  guaranteed: boolean;
  rates: {
    normal: number; rare: number;
    superRare: number; uberRare: number; legendRare: number;
  };
}
interface GachaBlock {
  header: {
    startDate: string; startTime: string;
    endDate: string; endTime: string;
    minVersion: string; maxVersion: string;
    gachaCount: number;
  };
  gachas: GachaEntry[];
}
interface GachaJson { updatedAt: string; data: GachaBlock[]; }

function parseDate(dateStr: string, timeStr: string): Date {
  const d = dateStr.padStart(8, "0");
  const t = timeStr.padStart(4, "0");
  return new Date(
    `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}:00+09:00`
  );
}

function formatDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const m  = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(jst.getUTCDate()).padStart(2, "0");
  const wd = WEEKDAYS[jst.getUTCDay()];
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${m}/${d}(${wd}) ${hh}:${mm}`;
}

async function buildScheduleEmbeds(json: GachaJson): Promise<EmbedBuilder[]> {
  const nameMap = await fetchNameMap();
  const now = new Date();
  const blocks = json.data
    .filter((b) =>
      b.header.endDate !== "20300101" &&
      parseDate(b.header.endDate, b.header.endTime) >= now
    )
    .sort((a, b) =>
      parseDate(a.header.startDate, a.header.startTime).getTime() -
      parseDate(b.header.startDate, b.header.startTime).getTime()
    );

  if (blocks.length === 0) return [];

  const embeds: EmbedBuilder[] = [];
  let current = new EmbedBuilder()
    .setTitle("今後開催予定のガチャ一覧")
    .setColor(0xf0a500)
    .setFooter({ text: `更新: ${json.updatedAt}` });
  let count = 0;

  for (const block of blocks) {
    const { header, gachas } = block;
    const start = parseDate(header.startDate, header.startTime);
    const end   = parseDate(header.endDate,   header.endTime);
    const isActive = start <= now;
    const lines: string[] = [];
    for (const g of gachas) {
      const flag       = FLAGS_MAP[g.flags] ?? "";
      const guaranteed = g.guaranteed ? "【確定】" : "";
      const rates = [g.rates.rare, g.rates.superRare, g.rates.uberRare, g.rates.legendRare].join(",");
      const name = nameMap.get(g.id) ?? "不明";
      lines.push(`・**${g.id}** ${name} (pos:${header.gachaCount})`);
      lines.push(`レート > ${rates}${guaranteed}${flag ? " " + flag : ""}`);
    }
    if (count >= 25) {
      embeds.push(current);
      current = new EmbedBuilder().setColor(0xf0a500);
      count = 0;
    }
    current.addFields({
      name: `${isActive ? "🟢" : "🔵"} ${formatDate(start)}～${formatDate(end)}`,
      value: `ver.${header.minVersion}～${header.maxVersion}\n${lines.join("\n")}`,
      inline: false,
    });
    count++;
  }
  embeds.push(current);
  return embeds;
}

function verifySignature(body: string, signature: string): boolean {
  if (!SECRET) return true;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function startWebhookServer(client: Client): void {
  const channelId = process.env.GACHA_NOTIFY_CHANNEL_ID;
  const userId    = process.env.GACHA_NOTIFY_USER_ID;

  if (!channelId || !userId) {
    console.warn("[webhook] GACHA_NOTIFY_CHANNEL_ID または GACHA_NOTIFY_USER_ID が未設定");
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    if (req.method !== "POST" || req.url !== "/webhook") {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      const sig = (req.headers["x-hub-signature-256"] as string) ?? "";
      if (SECRET && !verifySignature(body, sig)) {
        console.warn("[webhook] 署名検証失敗");
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }

      res.writeHead(200);
      res.end("ok");

      let payload: { commits?: { modified?: string[]; added?: string[] }[] };
      try {
        payload = JSON.parse(body);
      } catch {
        return;
      }

      const changed = payload.commits?.some((c) =>
        [...(c.modified ?? []), ...(c.added ?? [])].some((f) => f === TARGET_FILE)
      );
      if (!changed) return;

      console.log("[webhook] gatya.json の更新を検知");

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased()) return;
      const textChannel = channel as TextChannel;

      const mentions = userId.split(",").map((id) => `<@${id.trim()}>`).join(" ");
      await textChannel.send(
        `${mentions} まいjsonが更新されたよ！スケジュール更新かも？\nhttps://github.com/sinsuirakv0/KBC-rakv0-test/tree/main/data\nhttps://kbc-rakv0.vercel.app/main/event.html`
      );

      try {
        const jsonRes = await fetch(
          "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-test/main/data/gatya.json"
        );
        const json = (await jsonRes.json()) as GachaJson;
        const embeds = await buildScheduleEmbeds(json);
        for (const embed of embeds) {
          await textChannel.send({ embeds: [embed] });
        }
      } catch (err) {
        console.error("[webhook] JSON取得エラー:", err);
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[webhook] HTTPサーバー起動 ポート:${PORT}`);
  });
}
