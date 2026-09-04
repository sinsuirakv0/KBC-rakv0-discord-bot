import { CommandContext, CommandRegistry, ParsedCommandInput } from "./types";

export async function dispatchCommand(
  input: ParsedCommandInput,
  registry: CommandRegistry,
  context: CommandContext,
): Promise<boolean> {
  const command = registry.resolve(input.name);
  if (!command) {
    return false;
  }

  if (command.guildOnly && !context.inGuild) {
    return false;
  }

  await command.execute(context, input.args);
  return true;
}
