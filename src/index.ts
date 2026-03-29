import "dotenv/config";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Message,
} from "discord.js";
import fs from "fs";
import path from "path";
import { Command } from "./types/Command";
import { startWebhookServer } from "./utils/webhookServer";

const PREFIX = "o.";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const commands = new Collection<string, Command>();
(client as typeof client & { commands: Collection<string, Command> }).commands = commands;

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith(".js") || f.endsWith(".ts"));

for (const file of commandFiles) {
  const command: Command = require(path.join(commandsPath, file));
  commands.set(command.name, command);
}

client.once("ready", () => {
  console.log("Logged in as " + client.user?.tag);
  console.log("Prefix: " + PREFIX);
  client.user?.setActivity(PREFIX + "help でコマンド一覧", { type: 0 });
  startWebhookServer(client);
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();

  if (!commandName) return;

  const command = commands.get(commandName);

  if (!command) {
    await message.reply(
      "❓ `" + PREFIX + commandName + "` は存在しないコマンドです。`" + PREFIX + "help` でコマンド一覧を確認してください。"
    );
    return;
  }

  try {
    await command.execute(message, args);
  } catch (err) {
    console.error("[ERROR] " + PREFIX + commandName + ":", err);
    await message.reply("⚠️ コマンドの実行中にエラーが発生しました。");
  }
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

client.login(process.env.DISCORD_TOKEN);


import { startSaleScheduler } from "./scheduler/saleScheduler";

client.once("ready", () => {
  startSaleScheduler(client, "1446169322392387727");
});
```

---

**動作の仕組み**

30秒ごとにチェックし、同じ分は1回だけ処理します。

**リアルタイム通知**（イベント開始時刻ちょうどに発火）
```
🔔 イベント開始
```
コードブロック：
```
100 にゃんチケ★チャンス！ (1h)
101 極にゃんチケ★チャンス！ (1h)
```
1件のみなら `🔔 100 にゃんチケ★チャンス！ (1h)` と1行で。

**毎日22:00 JST** — 翌日のスケジュールをコードブロックで：
```
3/30(月) のイベント

[00:00]
　～24:00 月曜ステージ、...
[07:00]
　～08:00 にゃんチケ★チャンス！
[12:00]
　～13:00 超ゲリラ経験値にゃ！
