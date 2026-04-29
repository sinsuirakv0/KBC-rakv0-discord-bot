import fs from "fs";
import path from "path";

export function loadCommands(): Record<string, string> {
  const filePath = path.join(__dirname, "commands.json");
  const json = fs.readFileSync(filePath, "utf8");
  return JSON.parse(json);
}
