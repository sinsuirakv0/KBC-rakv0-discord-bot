import { staticCommandResponses } from "./static/data-source";
import { gatyaCommand } from "./gatya/command";
import { createHelpCommand, withCommandHelp } from "./help/command";
import { itemCommand } from "./item/command";
import { saleCommand } from "./sale/command";
import { stCommand } from "./st/command";
import { tutCommand } from "./tut/command";
import { CommandDefinition, CommandRegistry } from "./types";
import { utCommand } from "./ut/command";
import { pushCommand } from "./push/command";
import { skdCommand } from "./skd/command";

export type StaticCommandResponses = Readonly<Record<string, string>>;

export function createStaticCommandDefinitions(
  staticResponses: StaticCommandResponses,
): readonly CommandDefinition[] {
  return Object.entries(staticResponses).map<CommandDefinition>(([name, response]) =>
    withCommandHelp(
      {
        name,
        guildOnly: true,
        async execute(context): Promise<void> {
          await context.reply(response);
        },
      },
      { fallback: response },
    ),
  );
}

export const staticCommandDefinitions = createStaticCommandDefinitions(
  staticCommandResponses,
);
export const dynamicCommandDefinitions: readonly CommandDefinition[] = [
  createHelpCommand(),
  withCommandHelp(saleCommand),
  withCommandHelp(gatyaCommand),
  withCommandHelp(itemCommand),
  withCommandHelp(stCommand),
  withCommandHelp(tutCommand),
  withCommandHelp(utCommand),
  withCommandHelp(pushCommand),
  withCommandHelp(skdCommand),
];
export const commandDefinitions: readonly CommandDefinition[] = [
  ...staticCommandDefinitions,
  ...dynamicCommandDefinitions,
];

export function createCommandRegistry(
  definitions: readonly CommandDefinition[],
): CommandRegistry {
  const commandsByName = new Map<string, CommandDefinition>();

  for (const definition of definitions) {
    const names = [definition.name, ...(definition.aliases ?? [])];
    for (const name of names) {
      const normalizedName = name.toLowerCase();
      if (commandsByName.has(normalizedName)) {
        throw new Error(`Duplicate command registration: ${normalizedName}`);
      }
      commandsByName.set(normalizedName, definition);
    }
  }

  return {
    resolve(name: string): CommandDefinition | undefined {
      return commandsByName.get(name.toLowerCase());
    },
  };
}

export const commandRegistry = createCommandRegistry(commandDefinitions);
