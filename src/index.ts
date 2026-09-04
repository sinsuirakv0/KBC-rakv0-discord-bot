import { Client, GatewayIntentBits } from "discord.js";
import { commandRegistry } from "./commands/registry";
import { loadConfig } from "./config/env";
import { handleDiscordMessage } from "./discord/message-handler";

const config = loadConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once("ready", () => {
  console.log(`Bot started: ${client.user?.tag ?? "unknown"}`);
});

client.on("messageCreate", async (message) => {
  try {
    await handleDiscordMessage(message, {
      prefix: config.commandPrefix,
      registry: commandRegistry,
    });
  } catch (error) {
    console.error("Command execution failed.", error);
  }
});

void client.login(config.discordToken).catch((error: unknown) => {
  console.error("Discord login failed.", error);
  process.exitCode = 1;
});
