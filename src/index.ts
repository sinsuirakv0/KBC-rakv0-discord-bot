import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { loadCommands } from "./commands/commandLoader";

dotenv.config();

const PREFIX = "o.";
const commands = loadCommands();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Bot起動: ${client.user?.tag}`);
});

client.on("messageCreate", (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const name = message.content.slice(PREFIX.length).trim().toLowerCase();

  if (name in commands) {
    message.reply(commands[name]);
  }
});

client.login(process.env.DISCORD_TOKEN);
