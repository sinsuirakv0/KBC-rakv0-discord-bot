import { Command } from "../types/Command";
import { runPingTest } from "../scheduler/saleScheduler";

export const command: Command = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",
  async execute(message, args) {
    await runPingTest(message.client);
  },
};

