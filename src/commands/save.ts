import crypto from "crypto";
import { AttachmentBuilder, Message, TextChannel } from "discord.js";
import { Command } from "../types/Command";

const VERSION = 150201;

const COUNTRY_ALIAS: Record<string, string> = {
  jp: "ja",
  kr: "ko",
  tw: "tw",
  ja: "ja",
  en: "en",
  ko: "ko",
};

const save: Command = {
  name: "save",
  description: "にゃんこのセーブファイルをダウンロードしてDMに送ります",
  usage: "k.save <引継ぎコード> <認証番号> <国コード>",

  async execute(message: Message, args: string[]): Promise<void> {
    const { author } = message;
    const channel = message.channel as TextChannel;

    // コマンドメッセージを即削除
    await message.delete().catch(() => void 0);
    const noticeMsg = await channel.send("コマンドを削除しました。念のため機種変更手続きを中止してください。");
    setTimeout(() => noticeMsg.delete().catch(() => void 0), 10_000);

    if (args.length < 3) {
      const err = await channel.send(
        `❌ 使い方: \`ke.save <引継ぎコード> <認証番号> <国コード>\`\n例: \`ke.save 1f46287b2 5678 ja\``
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const transfer = args[0];
    const pin = args[1];
    const rawCountry = args[2].toLowerCase();
    const countryCode = COUNTRY_ALIAS[rawCountry];

    if (!countryCode) {
      const err = await channel.send(
        `❌ 国コードは \`ja\` / \`en\` / \`ko\` / \`tw\` (または \`jp\` / \`kr\`) を指定してください`
      );
      setTimeout(() => err.delete().catch(() => void 0), 10_000);
      return;
    }

    const processingMsg = await channel.send(
      `セーブデータを取得中...`
    );

    const nonce = crypto.randomBytes(16).toString("hex");
    const url = `https://nyanko-save.ponosgames.com/v2/transfers/${encodeURIComponent(
      transfer
    )}/reception`;

    const payload = {
      clientInfo: {
        client: { countryCode, version: VERSION },
        device: { model: "SM-G955F" },
        os: { type: "android", version: "9" },
      },
      nonce,
      pin: String(pin),
    };

    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      await processingMsg.edit(`❌ APIへの接続に失敗しました`);
      console.error("[save] fetch error:", err);
      return;
    }

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      await processingMsg.edit(
        `❌ エラー`
      );
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/octet-stream")) {
      const body = await upstream.text().catch(() => "");
      await processingMsg.edit(
        `❌ 予期しないレスポンス形式`
      );
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      const dm = await author.createDM();
      const attachment = new AttachmentBuilder(buffer, { name: "SAVE_DATA" });
      await dm.send({
        content: `✅ セーブデータです！\n引継ぎコード: \`${transfer}\`\n認証番号: \`${pin}\``,
        files: [attachment],
      });
      await processingMsg.edit(`✅ DMにセーブデータを送信しました！`);
    } catch (err) {
      await processingMsg.edit(
        `❌ DMの送信に失敗しました。DMを受け取れる設定になっているか確認してください。`
      );
      console.error("[save] DM send error:", err);
    }
  },
};

module.exports = save;
