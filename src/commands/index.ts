import { Message, TextBasedChannel } from "discord.js";
import commands from "./commands.json";

export function handleCommand(message: Message, name: string): void {
  const response = (commands as Record<string, string>)[name];
  if (!response) return;
  if (!message.channel || !("send" in message.channel)) return;

  (message.channel as TextBasedChannel).send(response);
}
