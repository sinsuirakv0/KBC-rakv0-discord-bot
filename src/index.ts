import { Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { handleCommand } from "./commands";

dotenv.config();

const PREFIX = "o.";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once("ready", () => {
  console.log(`Bot起動: ${client.user?.tag}`);
});

client.on("messageCreate", (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.inGuild()) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const name = args[0].toLowerCase();
  handleCommand(message, name, args.slice(1));
});

client.login(process.env.DISCORD_TOKEN);