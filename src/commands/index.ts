import { Message } from "discord.js";
import commands from "./commands.json";

export function handleCommand(message: Message, name: string, args: string[]): void {
  // 動的コマンド（sale等）
  try {
    const cmd = require(`./${name}`);
    const command = cmd.default ?? cmd;
    if (typeof command.execute === "function") {
      command.execute(message, args);
      return;
    }
  } catch {
    // ファイルがなければ無視
  }

  // commands.jsonの静的コマンド
  const response = (commands as Record<string, string>)[name];
  if (response && "send" in message.channel) {
    message.channel.send(response);
  }
}