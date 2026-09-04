import { ParsedCommandInput } from "./types";

export function parseCommandInput(
  content: string,
  prefix: string,
): ParsedCommandInput | undefined {
  if (!content.startsWith(prefix)) {
    return undefined;
  }

  const commandText = content.slice(prefix.length).trim();
  if (!commandText) {
    return undefined;
  }

  const [name, ...args] = commandText.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args,
  };
}
