import { Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";
import { runPingTest } from "../scheduler/saleScheduler";

const sukesanping: Command = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",
  usage: "o.sukesanping d | o.sukesanping <HHMM>",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;
    await runPingTest(channel, args[0]);
  },
};

module.exports = sukesanping;
