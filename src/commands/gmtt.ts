import { Message, TextChannel } from "discord.js";

const GAS_URL = process.env.GAS_URL ?? "";
const CSV_BASE =
  "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-test/main/csv/gamatoto/";
const CSV_LOG2 = `${CSV_BASE}GamatotoExpedition_Log_2_ja.csv`;
const CSV_LOG3 = `${CSV_BASE}GamatotoExpedition_Log_3_ja.csv`;
const CSV_STAGE = `${CSV_BASE}GamatotoExpedition_Stage_name_ja.csv`;
const CSV_STAGE_EVENT = `${CSV_BASE}GamatotoExpedition_Stage_nameEvent_ja.csv`;

const SPINNER_FRAMES = [
  "- 処理中.", "\\ 処理中..", "| 処理中...", "/ 処理中",
];

const HOURS_CONFIG: Record<string, { hours: number; count: number }> = {
  "1h": { hours: 1, count: 6 },
  "3h": { hours: 3, count: 18 },
  "6h": { hours: 6, count: 36 },
};

interface Team { captain: string; members: string[]; }
interface UserData { teams: Team[]; }

async function createSpinner(channel: TextChannel) {
  const msg = await channel.send(SPINNER_FRAMES[0]);
  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    msg.edit(SPINNER_FRAMES[frame]).catch(() => {});
  }, 400);
  return { msg, stop() { clearInterval(interval); } };
}

function parseCsv(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.split("\t")[0].replace(/,\s*$/, "").trim())
    .filter(line => line.length > 0 && !line.startsWith("//"));
}

async function fetchCsv(url: string): Promise<string[]> {
  const res = await fetch(url);
  return parseCsv(await res.text());
}

function randPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function loadUserData(userId: string): Promise<UserData> {
  if (!GAS_URL) return { teams: [] };
  try {
    const res = await fetch(`${GAS_URL}?userId=${encodeURIComponent(userId)}`);
    const json = await res.json() as { teams?: Team[] };
    return { teams: json.teams ?? [] };
  } catch {
    return { teams: [] };
  }
}

async function saveUserData(userId: string, data: UserData): Promise<boolean> {
  if (!GAS_URL) return false;
  try {
    await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, teams: data.teams }),
    });
    return true;
  } catch {
    return false;
  }
}

function generateTimes(hours: number, count: number): string[] {
  const totalMinutes = hours * 60;
  const times = Array.from({ length: count }, () =>
    Math.floor(Math.random() * (totalMinutes - 1))
  ).sort((a, b) => a - b);
  return times.map(m => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  });
}

async function generateLogs(team: Team, hours: number, count: number): Promise<string> {
  const [log2, log3, stages, stagesEvent] = await Promise.all([
    fetchCsv(CSV_LOG2), fetchCsv(CSV_LOG3),
    fetchCsv(CSV_STAGE), fetchCsv(CSV_STAGE_EVENT),
  ]);
  const allMembers = [team.captain, ...team.members];
  const times = generateTimes(hours, count);
  const endTime = `${String(hours).padStart(2, "0")}:00`;
  const allStages = [...stages, ...stagesEvent];
  const lines: string[] = [];
  for (const time of times) {
    lines.push(`${time} ${randPick(allMembers)}は${randPick(log2)}${randPick(log3)}`);
  }
  lines.push(`${endTime} ${team.captain}は${randPick(allStages)}から帰還しました`);
  return lines.join("\n");
}

async function handleList(userId: string, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  const data = await loadUserData(userId);
  spinner.stop();
  await spinner.msg.delete().catch(() => {});
  if (data.teams.length === 0) {
    await channel.send("探検隊が登録されていません\n`o.gmtt team 隊長,隊員1,隊員2,...` で登録してください");
    return;
  }
  const lines = data.teams.map((t, i) => `${i + 1}. ${t.captain}探検隊`);
  await channel.send("```\n" + lines.join("\n") + "\n```");
}

async function handleDetail(userId: string, index: number, channel: TextChannel): Promise<void> {
  const spinner = await createSpinner(channel);
  const data = await loadUserData(userId);
  spinner.stop();
  await spinner.msg.delete().catch(() => {});
  const team = data.teams[index];
  if (!team) { await channel.send(`❌ 探検隊 ${index + 1} は登録されていません`); return; }
  const lines = [
    `${team.captain}探検隊`,
    `隊長: ${team.captain}`,
    ...team.members.map((m, i) => `隊員${i + 1}: ${m}`),
  ];
  await channel.send("```\n" + lines.join("\n") + "\n```");
}

async function handleTeamSet(userId: string, input: string, channel: TextChannel): Promise<void> {
  const names = input.split(",").map(s => s.trim()).filter(s => s.length > 0);
  if (names.length < 1) { await channel.send("❌ 隊長の名前を入力してください"); return; }
  if (names.length > 11) { await channel.send("❌ 隊長1人＋隊員最大10人まで登録できます"); return; }
  const captain = names[0];
  const members = names.slice(1);
  const spinner = await createSpinner(channel);
  const data = await loadUserData(userId);
  data.teams.push({ captain, members });
  const saved = await saveUserData(userId, data);
  spinner.stop();
  await spinner.msg.delete().catch(() => {});
  if (!saved) { await channel.send("❌ 保存に失敗しました。GAS_URLが設定されているか確認してください"); return; }
  const lines = [`✅ ${captain}探検隊を登録しました (No.${data.teams.length})`, `隊長: ${captain}`, ...members.map((m, i) => `隊員${i + 1}: ${m}`)];
  await channel.send("```\n" + lines.join("\n") + "\n```");
}

async function handleGenerate(userId: string, index: number, timeKey: string, channel: TextChannel): Promise<void> {
  const config = HOURS_CONFIG[timeKey];
  if (!config) { await channel.send("❌ 時間は `1h` / `3h` / `6h` で指定してください"); return; }
  const spinner = await createSpinner(channel);
  const data = await loadUserData(userId);
  const team = data.teams[index];
  if (!team) { spinner.stop(); await spinner.msg.edit(`❌ 探検隊 ${index + 1} は登録されていません`); return; }
  let logText: string;
  try {
    logText = await generateLogs(team, config.hours, config.count);
  } catch {
    spinner.stop();
    await spinner.msg.edit("❌ CSVの取得に失敗しました");
    return;
  }
  spinner.stop();
  await spinner.msg.delete().catch(() => {});
  await channel.send("```\n" + logText + "\n```");
}

const gmtt = {
  name: "gmtt",
  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;
    const userId = message.author.id;
    if (args.length === 0) { await handleList(userId, channel); return; }
    if (args[0].toLowerCase() === "team") {
      const input = args.slice(1).join(" ");
      if (!input) { await channel.send("❌ 使い方: `o.gmtt team 隊長,隊員1,隊員2,...`"); return; }
      await handleTeamSet(userId, input, channel);
      return;
    }
    const num = parseInt(args[0]);
    if (!isNaN(num) && String(num) === args[0]) {
      const index = num - 1;
      if (args.length === 1) await handleDetail(userId, index, channel);
      else await handleGenerate(userId, index, args[1].toLowerCase(), channel);
      return;
    }
    await channel.send(
      "❌ 使い方:\n　`o.gmtt` — 探検隊一覧\n　`o.gmtt team 隊長,隊員1,...` — 探検隊登録\n　`o.gmtt <番号>` — 探検隊詳細\n　`o.gmtt <番号> 1h|3h|6h` — ログ生成"
    );
  },
};

module.exports = gmtt;