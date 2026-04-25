import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadCommands(): Record<string, string> {
  const filePath = path.join(__dirname, "commands.json");
  const json = fs.readFileSync(filePath, "utf8");
  return JSON.parse(json);
}
