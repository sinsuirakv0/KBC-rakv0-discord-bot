import { Command } from "../types/Command";
import { registerPingCommand } from "../scheduler/saleScheduler";

export const command: Command = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",
  async execute(message, args) {
    // registerPingCommand は messageCreate を監視する関数なので、
    // ここで一度だけ登録しておく
    registerPingCommand(message.client);

    // そして「このメッセージをもう一度発火」させて
    // registerPingCommand 側の処理を実行させる
    message.client.emit("messageCreate", message);
  },
};
