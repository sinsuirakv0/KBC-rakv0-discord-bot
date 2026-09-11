import { Message } from "discord.js";
import { dispatchCommand } from "../commands/dispatcher";
import { parseCommandInput } from "../commands/input";
import { CommandRegistry } from "../commands/types";
import { SentCommandMessage } from "../commands/types";
import { isBotAdministrator } from "../config/administrators";

export interface MessageHandlerOptions {
  prefix: string;
  registry: CommandRegistry;
}

function adaptSentMessage(sentMessage: Message): SentCommandMessage {
  return {
    async edit(nextContent: string): Promise<void> {
      await sentMessage.edit(nextContent);
    },
    async react(emoji: string): Promise<void> {
      await sentMessage.react(emoji);
    },
    async clearReactions(): Promise<void> {
      await sentMessage.reactions.removeAll();
    },
    async waitForUserReaction(
      emojis: readonly string[],
      userId: string,
      timeoutMs: number,
    ): Promise<string | undefined> {
      try {
        const collected = await sentMessage.awaitReactions({
          filter: (reaction, user) =>
            emojis.includes(reaction.emoji.name ?? "") && user.id === userId,
          max: 1,
          time: timeoutMs,
          errors: ["time"],
        });
        return collected.first()?.emoji.name ?? undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export async function handleDiscordMessage(
  message: Message,
  options: MessageHandlerOptions,
): Promise<void> {
  if (message.author.bot) {
    return;
  }

  const input = parseCommandInput(message.content, options.prefix);
  if (!input) {
    return;
  }

  if (!("send" in message.channel)) {
    return;
  }

  const channel = message.channel;

  await dispatchCommand(input, options.registry, {
    inGuild: message.inGuild(),
    guildId: message.guildId ?? undefined,
    channelId: message.channelId,
    userId: message.author.id,
    isBotAdministrator: isBotAdministrator(message.author.id),
    async reply(content: string): Promise<void> {
      await channel.send(content);
    },
    interactive: {
      userId: message.author.id,
      async send(content: string) {
        const sentMessage = await channel.send(content);
        return adaptSentMessage(sentMessage);
      },
      async sendAttachment(attachment) {
        const sentMessage = await channel.send({
          files: [{
            attachment: Buffer.from(attachment.data),
            name: attachment.filename,
          }],
        });
        return adaptSentMessage(sentMessage);
      },
    },
  });
}
