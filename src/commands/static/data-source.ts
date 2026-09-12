import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { staticCommandResponseDirectory } from "../../config/static-commands";

const RESPONSE_FILE_PATTERN = /^([a-z0-9_-]+)\.txt$/;

function normalizeResponse(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "");
}

export function loadStaticCommandResponses(
  directory = staticCommandResponseDirectory,
): Readonly<Record<string, string>> {
  const responses: Record<string, string> = {};
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const file of files) {
    const match = RESPONSE_FILE_PATTERN.exec(file.name);
    if (!match) {
      throw new Error(`Invalid static command response filename: ${file.name}`);
    }

    const commandName = match[1];
    const response = normalizeResponse(
      readFileSync(path.join(directory, file.name), "utf8"),
    );
    if (!response) {
      throw new Error(`Static command response is empty: ${file.name}`);
    }
    responses[commandName] = response;
  }

  return responses;
}

export const staticCommandResponses = loadStaticCommandResponses();
