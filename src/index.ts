import { Client, GatewayIntentBits } from "discord.js";
import { commandRegistry } from "./commands/registry";
import { loadConfig } from "./config/env";
import { handleDiscordMessage } from "./discord/message-handler";
import { loadPushConfig } from "./config/push";
import { createDiscordNotificationTransport } from "./discord/notification-transport";
import { createDetectionService } from "./notifications/service";
import { createEventUpdateServer } from "./notifications/server";
import { getNotificationStore, isStorageReady, startStorage } from "./storage/runtime";
import { createScheduleDetailsBuilder } from "./notifications/skd/data-source";

const config = loadConfig();
const pushConfig = loadPushConfig();
startStorage();

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
  if (pushConfig.secret) {
    const server = createEventUpdateServer({
      secret: pushConfig.secret,
      receive: (() => {
        let receive: ReturnType<typeof createDetectionService> | undefined;
        return event => (receive ??= createDetectionService(getNotificationStore(), createDiscordNotificationTransport(client), createScheduleDetailsBuilder()))(event);
      })(),
      isReady: () => client.isReady() && isStorageReady(),
    });
    server.on("error", () => { console.error("Event update server failed."); process.exitCode = 1; });
    server.listen(pushConfig.port, pushConfig.host, () => console.log("Event update receiver started."));
  }
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
