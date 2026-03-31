import { Collection, EmbedBuilder, Message } from "discord.js";
import { Command } from "../types/Command";

const help: Command = {
  name: "help",
  description: "コマンド一覧を表示します",
  usage: "o.help",

  async execute(message: Message): Promise<void> {
    const commands = (
      message.client as typeof message.client & {
        commands?: Collection<string, Command>;
      }
    ).commands;

    const embed = new EmbedBuilder()
      .setTitle("📖 コマンド一覧")
      .setColor(0x5865f2)
      .setDescription("すべてのコマンドは `o.` から始まります");

    if (commands) {
      for (const [, cmd] of commands) {
        // field.name は 256 文字以内の制約があるため、コマンド名のみを使う。
        // usage（複数行になる場合がある）と description は value 側に入れる。
        const usageText = cmd.usage ?? `o.${cmd.name}`;
        const value = `\`\`\`\n${usageText}\n\`\`\`${cmd.description}`;

        embed.addFields({
          name: `o.${cmd.name}`,
          value,
          inline: false,
        });
      }
    }

    embed.setFooter({ text: message.guild?.name ?? "" });

    await message.reply({ embeds: [embed] });
  },
};

module.exports = help;
