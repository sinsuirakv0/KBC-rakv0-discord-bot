import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";
import { decryptDat, getOutputName, SALTS } from "../utils/datCrypto";

const decrypt: Command = {
  name: "復号化",
  description: ".datファイルをTSVに復号します",
  usage: "k.復号化 [locale: jp/en/kr/tw]",

  async execute(message: Message, args: string[]): Promise<void> {
    const channel = message.channel as TextChannel;
    const attachment = message.attachments.first();

    if (!attachment) {
      const err = await channel.send("❌ .datファイルを添付してください");
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    if (!attachment.name.endsWith(".dat")) {
      const err = await channel.send("❌ 復号化には .dat ファイルを添付してください");
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

    const processingMsg = await channel.send("復号化中...");

    try {
      const res = await fetch(attachment.url);
      const arrayBuffer = await res.arrayBuffer();
      const input = Buffer.from(arrayBuffer);

      const output = decryptDat(input);
      const outputName = getOutputName(attachment.name);

      const file = new AttachmentBuilder(output, { name: outputName });
      await channel.send({ content: `✅ 復号化完了: \`${outputName}\``, files: [file] });
      await processingMsg.delete().catch(() => void 0);
    } catch (err) {
      await processingMsg.edit("復号化に失敗しました");
      console.error("[復号化] error:", err);
    }
  },
};

module.exports = decrypt;
