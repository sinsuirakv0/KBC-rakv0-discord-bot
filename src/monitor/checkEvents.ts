import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Message,
  MessageCreateOptions,
} from "discord.js";

const OWNER = "sinsuirakv0";
const REPO = "KBC-rakv0-event";
const WORKFLOW_FILE = "check-events.yml";
const WORKFLOW_URL = `https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}`;
const API_RUNS_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs`;
const API_DISPATCH_URL = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

const THREAD_ID = "144619322392387727";
const MENTION_USER_ID = "1447045405257760820";
const CHECK_INTERVAL_MS = 60_000;
const ALERT_THRESHOLD_MS = 10 * 60_000;
const ERROR_NOTIFY_WINDOW_MS = 15 * 60_000;

let fallbackActive = false;
let fallbackInterval: ReturnType<typeof setInterval> | null = null;
let statusMessage: Message | null = null;
const notifiedErrorRunIds = new Set<number>();

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  event: string;
}

interface Sendable {
  send(options: string | MessageCreateOptions): Promise<Message>;
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
    const ch = await client.channels.fetch(THREAD_ID);
    if (!ch || !("send" in ch)) return null;
    return ch as unknown as Sendable;
  } catch {
    return null;
  }
}

function makeStopRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("stop_monitor")
      .setLabel("■ 実行停止")
      .setStyle(ButtonStyle.Danger)
  );
}

async function sendStatusMessage(channel: Sendable): Promise<void> {
  try {
    statusMessage = await channel.send({
      content: `check-events を代わりに実行中...\n<@${MENTION_USER_ID}> 正常に復旧したら自動停止します`,
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
    content: `<@${MENTION_USER_ID}> [check-events](${WORKFLOW_URL}) が10分以上正常に動作してないよ！代わりに実行しとくね！\n${WORKFLOW_URL}`,
  });

  await sendStatusMessage(channel);
  await triggerWorkflow().catch(() => {});

  fallbackInterval = setInterval(async () => {
    if (!fallbackActive) return;

    // cronが復旧したか確認
    try {
      const runs = await fetchLatestRuns();
      const now = Date.now();
      const scheduleRun = runs.find(
        r =>
          r.event === "schedule" &&
          now - new Date(r.created_at).getTime() < ALERT_THRESHOLD_MS
      );
      if (scheduleRun) {
        await stopFallback();
        const ch = await getChannel(client);
        if (ch) await ch.send("✅ check-events が復旧しました！代替実行を停止します");
        return;
      }
    } catch { /* ignore */ }

    await triggerWorkflow().catch(() => {});

    if (!statusMessage) {
      const ch = await getChannel(client);
      if (ch) await sendStatusMessage(ch);
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

  // エラー検知
  for (const run of runs) {
    if (
      run.conclusion === "failure" &&
      !notifiedErrorRunIds.has(run.id) &&
      now - new Date(run.updated_at).getTime() < ERROR_NOTIFY_WINDOW_MS
    ) {
      notifiedErrorRunIds.add(run.id);
      await channel.send(
        `<@${MENTION_USER_ID}> Check Eventsがエラーの為実行されませんでした\n${run.html_url}`
      );
    }
  }

  // 停止検知
  const lastRun = runs[0];
  const lastRunAge = lastRun
    ? now - new Date(lastRun.created_at).getTime()
    : Infinity;

  if (lastRunAge > ALERT_THRESHOLD_MS && !fallbackActive) {
    await startFallback(client, channel);
  }
}

export function startMonitor(client: Client): void {
  client.once("ready", () => {
    setTimeout(() => {
      check(client);
      setInterval(() => check(client), CHECK_INTERVAL_MS);
    }, 5000);

    client.on("messageCreate", async (message) => {
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

export async function handleStopButton(
  interaction: ButtonInteraction
): Promise<void> {
  if (interaction.customId !== "stop_monitor") return;

  if (interaction.user.id !== MENTION_USER_ID) {
    await interaction.reply({
      content: "このボタンは使用できません",
      ephemeral: true,
    });
    return;
  }

  await stopFallback();
  await interaction.update({
    content: "✅ 監視モードを手動停止しました",
    components: [],
  });
}