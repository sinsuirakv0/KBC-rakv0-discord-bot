import { Client } from "discord.js";
import { NotificationTransport } from "../notifications/types";

export function createDiscordNotificationTransport(client: Client): NotificationTransport {
  async function getChannel(channelId: string) {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.isDMBased() || !channel.isTextBased() || !("send" in channel)) {
      throw new Error("Notification channel unavailable");
    }
    return channel;
  }
  return {
    async send(channelId, content, nonce) {
      const channel = await getChannel(channelId);
      const message = await channel.send({ content, allowedMentions: { parse: [] }, nonce, enforceNonce: true });
      return message.id;
    },
    async edit(channelId, messageId, content) {
      const channel = await getChannel(channelId);
      await channel.messages.edit(messageId, { content, allowedMentions: { parse: [] } });
    },
  };
}
