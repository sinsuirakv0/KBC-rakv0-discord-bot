import { Message } from "discord.js";
import commands from "./commands.json";

export function handleCommand(message: Message, name: String): void {
  const response = (commands as Record<string, string>)[name as string];
  if (response) {
    message.reply(response);
  }
}
