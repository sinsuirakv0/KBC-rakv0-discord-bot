import { CommandContext, CommandDefinition } from "../types";
import { fileCommandHelpSource } from "./data-source";
import { CommandHelpSource } from "./types";

const HELP_ERROR_MESSAGE = "ヘルプの読み込みに失敗しました。";

async function sendCommandHelp(
  context: CommandContext,
  commandName: string,
  source: CommandHelpSource,
  fallback?: string,
): Promise<void> {
  try {
    await context.reply(await source.read(commandName));
  } catch (error) {
    if (fallback !== undefined) {
      await context.reply(fallback);
      return;
    }
    console.error(`Command help retrieval failed: ${commandName}`, error);
    await context.reply(HELP_ERROR_MESSAGE);
  }
}

interface CommandHelpOptions {
  source?: CommandHelpSource;
  fallback?: string;
}

export function withCommandHelp(
  definition: CommandDefinition,
  options: CommandHelpOptions = {},
): CommandDefinition {
  const source = options.source ?? fileCommandHelpSource;
  return {
    ...definition,
    async execute(context, args): Promise<void> {
      if (args[0]?.toLowerCase() === "help") {
        await sendCommandHelp(
          context,
          definition.name,
          source,
          options.fallback,
        );
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
