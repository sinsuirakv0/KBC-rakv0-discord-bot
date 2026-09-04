import { readFile } from "node:fs/promises";
import path from "node:path";
import { commandHelpDirectory } from "../../config/help";
import { CommandHelpSource } from "./types";

function assertCommandName(commandName: string): void {
  if (!/^[a-z0-9_-]+$/.test(commandName)) {
    throw new Error(`Invalid command help name: ${commandName}`);
  }
}

export function createFileCommandHelpSource(
  directory = commandHelpDirectory,
): CommandHelpSource {
  return {
    async read(commandName: string): Promise<string> {
      assertCommandName(commandName);
      const content = await readFile(path.join(directory, `${commandName}.txt`), "utf8");
      return content.replace(/^\uFEFF/, "");
    },
  };
}

export const fileCommandHelpSource = createFileCommandHelpSource();
