import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Message,
  MessageCreateOptions,
} from "discord.js";
import { captureHistoryTypeScreenshot } from "./screenshot";

const OWNER = "sinsuirakv0";
const REPO = "KBC-rakv0-event";
const WORKFLOW_FILE = "check-events.yml";
const WORKFLOW_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}`;
const API_RUNS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs`;
const API_DISPATCH_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

const THREAD_ID = "1446169322392387727";
const MENTION_USER_ID = "1447045405257760820";
const CHECK_INTERVAL_MS = 60_000;
const ALERT_THRESHOLD_MS = 10 * 60_000;
const ERROR_NOTIFY_WINDOW_MS = 15 * 60_000;
const EVENT_TYPES = new Set(["gatya", "sale", "item"]);

let fallbackActive = false;
let fallbackInterval: ReturnType<typeof setInterval> | null = null;
let statusMessage: Message | null = null;
let screenshotQueue: Promise<void> = Promise.resolve();
const notifiedErrorRunIds = new Set<number>();
const notifiedUpdateKeys = new Set<string>();

interface WorkflowRun {
  id: number;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  event: string;
}

interface Sendable {
  send(options: string | MessageCreateOptions): Promise<Message>;
}

export interface EventUpdatePayload {
  types?: unknown;
  detectedAt?: unknown;
  historyUrl?: unknown;
  runUrl?: unknown;
  source?: unknown;
}

function ghHeaders(): Record<string, string> {
  return {
    "Authorization": `token ${process.env.WORKFLOW_GITHUB_TOKEN ?? ""}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

async function fetchLatestRuns(): Promise<WorkflowRun[]> {
  const res = await fetch(`${API_RUNS_URL}?per_page=10`, { headers: ghHeaders() });
  if (!res.ok) return [];
  const json = await res.json() as { workflow_runs?: WorkflowRun[] };
  return json.workflow_runs ?? [];
}

async function triggerWorkflow(): Promise<void> {
  await fetch(API_DISPATCH_URL, {
    method: "POST",
    headers: ghHeaders(),
    body: JSON.stringify({ ref: "main" }),
  });
}

async function getChannel(client: Client): Promise<Sendable | null> {
  try {
    const channel = await client.channels.fetch(THREAD_ID);
    if (!channel || !("send" in channel)) return null;
    return channel as unknown as Sendable;
  } catch {
    return null;
  }
}

function makeStopRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("stop_monitor")
      .setLabel("代替実行を停止")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendStatusMessage(channel: Sendable): Promise<void> {
  try {
    statusMessage = await channel.send({
      content: `check-events を代替実行中です。\n<@${MENTION_USER_ID}> 正常に復旧したら停止してください。`,
      components: [makeStopRow()],
    });
  } catch {
    statusMessage = null;
  }
}

async function stopFallback(): Promise<void> {
  fallbackActive = false;
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
  if (statusMessage) {
    await statusMessage.delete().catch(() => {});
    statusMessage = null;
  }
}

async function startFallback(client: Client, channel: Sendable): Promise<void> {
  fallbackActive = true;
  await channel.send({
    content: `<@${MENTION_USER_ID}> [check-events](${WORKFLOW_URL}) が10分以上正常に動いていないようです。代替実行を開始します。\n${WORKFLOW_URL}`,
  });
  await sendStatusMessage(channel);
  await triggerWorkflow().catch(() => {});

  fallbackInterval = setInterval(async () => {
    if (!fallbackActive) return;

    try {
      const runs = await fetchLatestRuns();
      const now = Date.now();
      const scheduleRun = runs.find(run =>
        run.event === "schedule" &&
        now - new Date(run.created_at).getTime() < ALERT_THRESHOLD_MS
      );
      if (scheduleRun) {
        await stopFallback();
        const target = await getChannel(client);
        if (target) await target.send("check-events が復旧しました。代替実行を停止しました。");
        return;
      }
    } catch {
      // 次の周期で再確認する
    }

    await triggerWorkflow().catch(() => {});
    if (!statusMessage) {
      const target = await getChannel(client);
      if (target) await sendStatusMessage(target);
    }
  }, CHECK_INTERVAL_MS);
}

async function check(client: Client): Promise<void> {
  const channel = await getChannel(client);
  if (!channel) return;

  let runs: WorkflowRun[];
  try {
    runs = await fetchLatestRuns();
  } catch {
    return;
  }

  const now = Date.now();
  for (const run of runs) {
    if (
      run.conclusion === "failure" &&
      !notifiedErrorRunIds.has(run.id) &&
      now - new Date(run.updated_at).getTime() < ERROR_NOTIFY_WINDOW_MS
    ) {
      notifiedErrorRunIds.add(run.id);
      await channel.send(
        `<@${MENTION_USER_ID}> Check Events がエラーで完了しました。\n${run.html_url}`
      );
    }
  }

  const lastRun = runs[0];
  const lastRunAge = lastRun
    ? now - new Date(lastRun.created_at).getTime()
    : Infinity;
  if (lastRunAge > ALERT_THRESHOLD_MS && !fallbackActive) {
    await startFallback(client, channel);
  }
}

function normalizeTypes(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(
    raw.map(item => String(item).trim()).filter(item => EVENT_TYPES.has(item))
  )];
}

function formatDetectedAt(value: unknown): string {
  const date = typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : new Date();
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(valid);
}

function updateKey(types: string[], detectedAt: unknown, historyUrl: unknown): string {
  return `${types.join(",")}|${String(detectedAt ?? "")}|${String(historyUrl ?? "")}`;
}

async function attachHistoryScreenshotsLater(
  channel: Sendable,
  message: Message,
  baseContent: string,
  historyUrl: string | null,
  types: string[]
): Promise<void> {
  let attached = 0;
  try {
    for (const type of types) {
      const screenshot = await captureHistoryTypeScreenshot(historyUrl, type);
      if (!screenshot) continue;

      const file = new AttachmentBuilder(screenshot, {
        name: `event-history-${type}.jpg`,
      });
      await channel.send({
        content: `履歴 all: **${type}**`,
        files: [file],
      });
      attached++;

      // Northflank上での急激なメモリ・CPU使用を避ける
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("[event-update] screenshot follow-up failed:", error);
  }

  const result = attached > 0
    ? `履歴 all の差分スクリーンショットを種類別に ${attached} 枚送信しました。`
    : "スクリーンショットの作成に失敗しました。";
  await message.edit(`${baseContent}\n\n${result}`).catch(() => {});
}

export async function notifyScheduleUpdate(
  client: Client,
  payload: EventUpdatePayload
): Promise<void> {
  const channel = await getChannel(client);
  if (!channel) throw new Error("notification thread not found");

  const types = normalizeTypes(payload.types);
  if (types.length === 0) throw new Error("updated types are empty");

  const key = updateKey(types, payload.detectedAt, payload.historyUrl);
  if (notifiedUpdateKeys.has(key)) return;
  notifiedUpdateKeys.add(key);

  const historyUrl = typeof payload.historyUrl === "string" ? payload.historyUrl : null;
  const lines = [
    `<@${MENTION_USER_ID}> **スケジュール更新**`,
    `検知時間: ${formatDetectedAt(payload.detectedAt)}`,
    `更新: ${types.join(",")}`,
  ];
  if (historyUrl) lines.push("", historyUrl);

  const baseContent = lines.join("\n");
  const message = await channel.send({
    content: `${baseContent}\n\nスクリーンショットを生成中です...`,
  });
  screenshotQueue = screenshotQueue
    .then(() => attachHistoryScreenshotsLater(channel, message, baseContent, historyUrl, types))
    .catch(error => console.error("[event-update] screenshot queue failed:", error));
}

export function startMonitor(client: Client): void {
  client.once("ready", () => {
    setTimeout(() => {
      check(client);
      setInterval(() => check(client), CHECK_INTERVAL_MS);
    }, 5000);

    client.on("messageCreate", async message => {
      if (message.channelId !== THREAD_ID) return;
      if (message.author.id === client.user?.id) return;
      if (!fallbackActive || !statusMessage) return;

      await statusMessage.delete().catch(() => {});
      statusMessage = null;
      const channel = await getChannel(client);
      if (channel) await sendStatusMessage(channel);
    });
  });
}

export async function handleStopButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId !== "stop_monitor") return;

  if (interaction.user.id !== MENTION_USER_ID) {
    await interaction.reply({
      content: "このボタンは使用できません。",
      ephemeral: true,
    });
    return;
  }

  await stopFallback();
  await interaction.update({
    content: "監視の代替実行を手動停止しました。",
    components: [],
  });
}
