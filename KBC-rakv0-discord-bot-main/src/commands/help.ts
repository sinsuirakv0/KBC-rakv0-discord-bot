import { Collection, EmbedBuilder, Message } from "discord.js";
import { Command } from "../types/Command";

const help: Command = {
  name: "help",
  description: "コマンド一覧を表示します",
  usage: "k.help",

  async execute(message: Message): Promise<void> {
    // index.ts で登録したコレクションを参照
    const commands = (
      message.client as typeof message.client & {
        commands?: Collection<string, Command>;
      }
    ).commands;

    const embed = new EmbedBuilder()
      .setTitle("📖 コマンド一覧")
      .setColor(0x5865f2)
      .setDescription("すべてのコマンドは `k.` から始まります");

    if (commands) {
      for (const [, cmd] of commands) {
        embed.addFields({
          name: `\`${cmd.usage ?? `k.${cmd.name}`}\``,
          value: cmd.description,
          inline: false,
        });
      }
    }

    embed.setFooter({ text: `${message.guild?.name ?? ""}` });

    await message.reply({ embeds: [embed] });
  },
};

module.exports = help;
