import { Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";
import { runPingTest } from "../scheduler/saleScheduler";

const sukesanping: Command = {
  name: "sukesanping",
  description: "スケジューラの動作確認を行います",
  usage: [
    "o.sukesanping d [M/D]         : 翌日(または指定日)のスケジュール表示",
    "o.sukesanping <HHMM> [M/D]    : 指定時刻のイベント通知プレビュー",
  ].join("\n"),

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;

    // 引数パース: 最初の引数がHHMMまたは"d"、2番目が"M/D"形式の日付
    // 例: sukesanping d        → arg="d", dateStr=undefined
    // 例: sukesanping d 4/1   → arg="d", dateStr="4/1"
    // 例: sukesanping 2100     → arg="2100", dateStr=undefined
    // 例: sukesanping 2100 4/1 → arg="2100", dateStr="4/1"
    // 例: sukesanping          → arg=undefined, dateStr=undefined

    const arg = args[0];      // "d" | "HHMM" | undefined
    const dateStr = args[1];  // "M/D" | undefined

    await runPingTest(channel, arg, dateStr);
  },
};

module.exports = sukesanping;
