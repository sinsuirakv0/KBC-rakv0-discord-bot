import crypto from "crypto";
import { AttachmentBuilder, Message, TextChannel } from "discord.js";

const VERSION = 150201;

const COUNTRY_ALIAS: Record<string, string> = {
  jp: "ja", kr: "ko", tw: "tw", ja: "ja", en: "en", ko: "ko",
};

const SPINNER_FRAMES = [
  "- 処理中.", "\\ 処理中..", "| 処理中...", "/ 処理中",
];

async function createSpinner(channel: TextChannel) {
  const msg = await channel.send(SPINNER_FRAMES[0]);
  let frame = 0;
  const interval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    msg.edit(SPINNER_FRAMES[frame]).catch(() => {});
  }, 400);
  return { msg, stop() { clearInterval(interval); } };
}

const save = {
  name: "save",
  async execute(message: Message, args: string[]): Promise<void> {
    const { author } = message;
    const channel = message.channel as TextChannel;

    await message.delete().catch(() => {});
    const noticeMsg = await channel.send("コマンドを削除しました。念のため機種変更手続きを中止してください。");
    setTimeout(() => noticeMsg.delete().catch(() => {}), 10_000);

    if (args.length < 3) {
      const err = await channel.send(
        "❌ 使い方: `o.save <引継ぎコード> <認証番号> <国コード>`\n例: `o.save 1f46287b2 5678 ja`"
      );
      setTimeout(() => err.delete().catch(() => {}), 10_000);
      return;
    }

    const transfer = args[0];
    const pin = args[1];
    const rawCountry = args[2].toLowerCase();
    const countryCode = COUNTRY_ALIAS[rawCountry];

    if (!countryCode) {
      const err = await channel.send(
        "❌ 国コードは `ja` / `en` / `ko` / `tw` (または `jp` / `kr`) を指定してください"
      );
      setTimeout(() => err.delete().catch(() => {}), 10_000);
      return;
    }

    const spinner = await createSpinner(channel);

    const nonce = crypto.randomBytes(16).toString("hex");
    const url = `https://nyanko-save.ponosgames.com/v2/transfers/${encodeURIComponent(transfer)}/reception`;

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
      spinner.stop();
      await spinner.msg.edit("❌ APIへの接続に失敗しました");
      console.error("[save] fetch error:", err);
      return;
    }

    if (!upstream.ok) {
      spinner.stop();
      await spinner.msg.edit("❌ APIエラーが発生しました");
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/octet-stream")) {
      spinner.stop();
      await spinner.msg.edit("❌ 予期しないレスポンス形式です");
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    spinner.stop();

    try {
      const dm = await author.createDM();
      const attachment = new AttachmentBuilder(buffer, { name: "SAVE_DATA" });
      await dm.send({
        content: `✅ セーブファイルです！\n引継ぎコード: \`${transfer}\`\n認証番号: \`${pin}\``,
        files: [attachment],
      });
      await spinner.msg.edit("✅ DMにセーブファイルを送信しました！");
    } catch (err) {
      await spinner.msg.edit("❌ DMの送信に失敗しました。DMを受け取れる設定になっているか確認してください。");
      console.error("[save] DM send error:", err);
    }
  },
};

module.exports = save;