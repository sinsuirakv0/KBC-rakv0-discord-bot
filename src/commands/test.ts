import { Message } from "discord.js";
import { notifyScheduleUpdate } from "../monitor/checkEvents";

const EVENT_REPO_TREE_API =
  "https://api.github.com/repos/sinsuirakv0/KBC-rakv0-event/git/trees/main?recursive=1";
const EVENT_SITE_URL =
  process.env.EVENT_SITE_URL ?? "https://kbc-rakv0-event.vercel.app/";
const HISTORY_GROUP_SEC = 120;

interface GitTreeEntry {
  path: string;
}

interface ParsedRawFile {
  type: string;
  unix: number;
}

async function fetchLatestHistory(): Promise<{ unix: number; types: string[] }> {
  const res = await fetch(EVENT_REPO_TREE_API, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "KBC-rakv0-discord-bot",
    },
  });
  if (!res.ok) throw new Error(`GitHub raw list fetch failed: HTTP ${res.status}`);

  const body = await res.json() as { tree?: GitTreeEntry[]; truncated?: boolean };
  if (body.truncated) throw new Error("GitHub履歴一覧が大きすぎるため取得できません");

  const parsed: ParsedRawFile[] = (body.tree ?? []).flatMap(file => {
    const match = file.path.match(/^raw\/(gatya|sale|item)_(\d+)\.tsv$/);
    return match ? [{ type: match[1], unix: Number(match[2]) }] : [];
  });
  if (parsed.length === 0) throw new Error("履歴ファイルが見つかりません");

  const latestUnix = Math.max(...parsed.map(file => file.unix));
  const types = [...new Set(
    parsed
      .filter(file => latestUnix - file.unix <= HISTORY_GROUP_SEC)
      .map(file => file.type)
  )];

  return { unix: latestUnix, types };
}

function buildHistoryUrl(unix: number): string {
  const url = new URL(EVENT_SITE_URL);
  url.searchParams.set("tab", "history");
  url.searchParams.set("tsv", String(unix));
  url.searchParams.set("type", "all");
  return url.toString();
}

const test = {
  name: "test",
  async execute(message: Message, args: string[]): Promise<void> {
    if (args[0]?.toLowerCase() !== "event-update") return;

    const status = await message.reply("最新のイベント更新履歴を取得しています...");
    try {
      const latest = await fetchLatestHistory();
      await status.edit(
        `最新履歴を更新検知として通知します: ${latest.types.join(", ")}`
      );

      await notifyScheduleUpdate(message.client, {
        types: latest.types,
        detectedAt: new Date().toISOString(),
        historyUrl: buildHistoryUrl(latest.unix),
        source: "discord-command-test",
      });
      await status.edit("テスト通知を開始しました。画像は生成後に追記されます。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await status.edit(`テスト通知に失敗しました: ${reason}`);
    }
  },
};

module.exports = test;
