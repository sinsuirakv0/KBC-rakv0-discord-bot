import { InteractiveCommandOutput } from "../types";

export const DISCORD_TEXT_CHUNK_SIZE = 1_800;

export function splitTextIntoChunks(
  text: string,
  maxLength = DISCORD_TEXT_CHUNK_SIZE,
): readonly string[] {
  if (maxLength <= 0) throw new Error("maxLength must be positive");
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const line of text.split("\n")) {
    if (line.length > maxLength) {
      flush();
      for (let offset = 0; offset < line.length; offset += maxLength) {
        chunks.push(line.slice(offset, offset + maxLength));
      }
      continue;
    }
    const addition = current ? `\n${line}` : line;
    if (current && current.length + addition.length > maxLength) flush();
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks;
}

export async function sendChunked(
  output: InteractiveCommandOutput,
  text: string,
  language = "",
): Promise<void> {
  const opening = language ? `\`\`\`${language}\n` : "\`\`\`\n";
  for (const chunk of splitTextIntoChunks(text)) {
    await output.send(`${opening}${chunk}\n\`\`\``);
  }
}
