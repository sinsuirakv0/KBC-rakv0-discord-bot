import crypto from "crypto";
import { AttachmentBuilder, Message, ReactionCollector } from "discord.js";
import { Command } from "../types/Command";

const VERSION = 150201;

const COUNTRY_OPTIONS: { emoji: string; code: string }[] = [
  { emoji: "🇯🇵", code: "ja" },
  { emoji: "🇺🇸", code: "en" },
  { emoji: "🇰🇷", code: "ko" },
  { emoji: "🇹🇼", code: "tw" },
];

const save: Command = {
  name: "save",
  description: "にゃんこのセーブデータをダウンロードしてDMに送ります",
  usage: "k.save",

  async execute(message: Message): Promise<void> {
    const { author, channel } = message;

    // ① 引継ぎコードを質問
    await message.reply("🔑 引継ぎコード（Transfer Code）を入力してください");

    const transferMsg = await channel
      .awaitMessages({
        filter: (m) => m.author.id === author.id,
        max: 1,
      })
      .then((c) => c.first());

    if (!transferMsg) {
      await message.reply("❌ 引継ぎコードを取得できませんでした");
      return;
    }
    const transfer = transferMsg.content.trim();

    // ② 認証番号を質問
    await message.reply("🔢 認証番号（PIN）を入力してください");

    const pinMsg = await channel
      .awaitMessages({
        filter: (m) => m.author.id === author.id,
        max: 1,
      })
      .then((c) => c.first());

    if (!pinMsg) {
      await message.reply("❌ 認証番号を取得できませんでした");
      return;
    }
    const pin = pinMsg.content.trim();

    // ③ 国コードをリアクションで質問
    const reactionPrompt = await message.reply(
      "🌏 国コードをリアクションで選んでください\n" +
        COUNTRY_OPTIONS.map((o) => `${o.emoji} → \`${o.code}\``).join("\n")
    );

    for (const opt of COUNTRY_OPTIONS) {
      await reactionPrompt.react(opt.emoji);
    }

    const countryCode = await new Promise<string>((resolve) => {
      const collector: ReactionCollector = reactionPrompt.createReactionCollector(
        {
          filter: (reaction, user) => {
            return (
              user.id === author.id &&
              COUNTRY_OPTIONS.some((o) => o.emoji === reaction.emoji.name)
            );
          },
          max: 1,
        }
      );
      collector.on("collect", (reaction) => {
        const found = COUNTRY_OPTIONS.find(
          (o) => o.emoji === reaction.emoji.name
        );
        resolve(found?.code ?? "ja");
      });
    });

    // ④ API リクエスト
    const processingMsg = await message.reply("⏳ セーブデータを取得中...");

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
      await processingMsg.edit("❌ APIへの接続に失敗しました");
      console.error("[save] fetch error:", err);
      return;
    }

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      await processingMsg.edit(
        `❌ エラー: \`${upstream.status} ${upstream.statusText}\`\n\`\`\`${body.slice(0, 500)}\`\`\``
      );
      return;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/octet-stream")) {
      const body = await upstream.text().catch(() => "");
      await processingMsg.edit(
        `❌ 予期しないレスポンス形式: \`${contentType}\`\n\`\`\`${body.slice(0, 500)}\`\`\``
      );
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ⑤ DM に送信
    try {
      const dm = await author.createDM();
      const attachment = new AttachmentBuilder(buffer, { name: "SAVE_DATA" });
      await dm.send({
        content: `✅ セーブデータです（引継ぎコード: \`${transfer}\` / 国コード: \`${countryCode}\`）`,
        files: [attachment],
      });
      await processingMsg.edit("✅ DMにセーブデータを送信しました！");
    } catch (err) {
      await processingMsg.edit(
        "❌ DMの送信に失敗しました。DMを受け取れる設定になっているか確認してください。"
      );
      console.error("[save] DM send error:", err);
    }
  },
};

module.exports = save;
