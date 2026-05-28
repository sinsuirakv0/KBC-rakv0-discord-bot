import { ButtonInteraction, Client, GatewayIntentBits, Message } from "discord.js";
import dotenv from "dotenv";
import { handleCommand } from "./commands";
import { startMonitor, handleStopButton } from "./monitor/checkEvents";

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

startMonitor(client);

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

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  await handleStopButton(interaction as ButtonInteraction);
});

client.login(process.env.DISCORD_TOKEN);