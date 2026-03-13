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

// ============================================================
//  設定
// ============================================================
const PREFIX = "k.";

// ============================================================
//  クライアント初期化
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // プレフィックスコマンドに必須
  ],
});

// コマンドをコレクションに格納（help コマンドからも参照できるよう client に付与）
const commands = new Collection<string, Command>();
(client as typeof client & { commands: Collection<string, Command> }).commands = commands;

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith(".js") || f.endsWith(".ts"));

for (const file of commandFiles) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const command: Command = require(path.join(commandsPath, file));
  commands.set(command.name, command);
}

// ============================================================
//  イベント: 起動完了
// ============================================================
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  console.log(`📌 Prefix: "${PREFIX}"`);
  client.user?.setActivity(`${PREFIX}help でコマンド一覧`, { type: 0 });
});

// ============================================================
//  イベント: メッセージ受信
// ============================================================
client.on("messageCreate", async (message: Message) => {
  // ボット自身・DMは無視
  if (message.author.bot) return;
  if (!message.guild) return;

  // プレフィックスチェック
  if (!message.content.startsWith(PREFIX)) return;

  // コマンド名と引数を分解
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();

  if (!commandName) return;

  const command = commands.get(commandName);

  if (!command) {
    await message.reply(
      `❓ \`${PREFIX}${commandName}\` は存在しないコマンドだよ！\`
    );
    return;
  }

  try {
    await command.execute(message, args);
  } catch (err) {
    console.error(`[ERROR] ${PREFIX}${commandName}:`, err);
    await message.reply("⚠️ コマンドの実行中にエラーが発生しました。");
  }
});

// ============================================================
//  Northflank 向け: プロセスが落ちないようにエラーハンドリング
// ============================================================
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

// ログイン
client.login(process.env.DISCORD_TOKEN);
