import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";
import { encryptTsv, getOutputName, SALTS } from "../utils/datCrypto";

const encrypt: Command = {
  name: "暗号化",
  description: ".tsvファイルをDATに暗号化します",
  usage: "k.暗号化 [locale: jp/en/kr/tw]",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;
    const attachment = message.attachments.first();

    if (!attachment) {
      const err = await channel.send("❌ .tsvファイルを添付してください");
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    if (!attachment.name.endsWith(".tsv")) {
      const err = await channel.send("❌ 暗号化には .tsv ファイルを添付してください");
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const locale = args[0] ?? "jp";
    if (!SALTS[locale]) {
      const err = await channel.send(
        "❌ localeは `jp` / `en` / `kr` / `tw` を指定してください"
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const processingMsg = await channel.send("暗号化中...");

    try {
      const res = await fetch(attachment.url);
      const arrayBuffer = await res.arrayBuffer();
      const input = Buffer.from(arrayBuffer);

      const output = encryptTsv(input, locale);
      const outputName = getOutputName(attachment.name);

      const file = new AttachmentBuilder(output, { name: outputName });
      await channel.send({ content: `✅ 暗号化完了: \`${outputName}\``, files: [file] });
      await processingMsg.delete().catch(() => void 0);
    } catch (err) {
      await processingMsg.edit("暗号化に失敗しました");
      console.error("[暗号化] error:", err);
    }
  },
};

module.exports = encrypt;
