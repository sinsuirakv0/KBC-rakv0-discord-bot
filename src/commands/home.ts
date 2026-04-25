import { Message, EmbedBuilder } from "discord.js";
import { Command } from "../types/command";

export const home: Command = {
  name: "home",
  description: "複数のホームリンクを埋め込みで返します",
  usage: "o.home",

  async execute(message: Message) {
    const links = [
      { name: "KBCホーム", url: "https://kbc-rakv0.vercel.app" },
      { name: "KBCSecretホーム", url: "https://kbc-rakv0.vercel.app/secret/index.html" },
      { name: "GitHub", url: "https://github.com/sinsuirakv0" },
    ];

    const embed = new EmbedBuilder()
      .setTitle("リンク一覧")
      .setColor("#00AEEF")
      .setDescription(
        links.map(link => ` **${link.name}**\n${link.url}`).join("\n\n")
      )
      .setFooter({ text: "o.home でいつでも確認できます" });

    await message.reply({ embeds: [embed] });
  },
};
