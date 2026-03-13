import { Message } from "discord.js";
import { Command } from "../types/Command";

const ping: Command = {
  name: "ping",
  description: "ボットの応答速度を確認します",
  usage: "ke.ping",

  async execute(message: Message): Promise<void> {
    const sent = await message.reply("🏓 計測中...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = Math.round(message.client.ws.ping);

    await sent.edit(
      `🏓 Pong!\n📡 レイテンシ: **${latency}ms**\n💓 API レイテンシ: **${apiLatency}ms**`
    );
  },
};

module.exports = ping;
