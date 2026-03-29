import { Message } from "discord.js";
import { runPingTest } from "../scheduler/saleScheduler";

const sukesanping = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",

  async execute(message: Message, args: string[]) {
    await runPingTest(message.client);
  },
};

module.exports = sukesanping;
