import { runPingTest } from "../scheduler/saleScheduler";

module.exports = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",
  async execute(message, args) {
    await runPingTest(message.client);
  },
};
