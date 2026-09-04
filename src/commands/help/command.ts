import { CommandContext, CommandDefinition } from "../types";
import { fileCommandHelpSource } from "./data-source";
import { CommandHelpSource } from "./types";

const HELP_ERROR_MESSAGE = "ヘルプの読み込みに失敗しました。";

async function sendCommandHelp(
  context: CommandContext,
  commandName: string,
  source: CommandHelpSource,
): Promise<void> {
  try {
    await context.reply(await source.read(commandName));
  } catch (error) {
    console.error(`Command help retrieval failed: ${commandName}`, error);
    await context.reply(HELP_ERROR_MESSAGE);
  }
}

export function withCommandHelp(
  definition: CommandDefinition,
  source: CommandHelpSource = fileCommandHelpSource,
): CommandDefinition {
  return {
    ...definition,
    async execute(context, args): Promise<void> {
      if (args[0]?.toLowerCase() === "help") {
        await sendCommandHelp(context, definition.name, source);
        return;
      }
      await definition.execute(context, args);
    },
  };
}

export function createHelpCommand(
  source: CommandHelpSource = fileCommandHelpSource,
): CommandDefinition {
  return {
    name: "help",
    guildOnly: true,
    async execute(context: CommandContext): Promise<void> {
      await sendCommandHelp(context, "index", source);
    },
  };
}
