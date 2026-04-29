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
  ],
});

client.once("ready", () => {
  console.log(`Bot起動: ${client.user?.tag}`);
});

client.on("messageCreate", (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  
if (!message.channel?.isTextBased()) return;

  const name = message.content.slice(PREFIX.length).trim().toLowerCase();
  handleCommand(message, name);
});

client.login(process.env.DISCORD_TOKEN);
