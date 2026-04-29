import { Message } from "discord.js";
import commands from "./commands.json";

export function handleCommand(message: Message, name: string): void {
  const response = (commands as Record<string, string>)[name];
  if (response) {
    message.channel.send(response);
  }
}
