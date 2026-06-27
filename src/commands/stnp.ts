import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Guild,
  GuildEmoji,
  Message,
  PermissionFlagsBits,
  PermissionsBitField,
  Sticker,
  TextChannel,
} from "discord.js";

const SNOWFLAKE_RE = /^\d{17,20}$/;
const PROGRESS_INTERVAL = 5;
const STICKER_SELECT_TIMEOUT_MS = 60_000;

interface CopyStats {
  copied: number;
  skipped: number;
  failed: number;
  stopped: boolean;
  timedOut: boolean;
  errors: string[];
}

type StickerDecision = "copy" | "skip" | "stop" | "timeout";

function blankStats(): CopyStats {
  return {
    copied: 0,
    skipped: 0,
    failed: 0,
    stopped: false,
    timedOut: false,
    errors: [],
  };
}

function hasExpressionPermission(memberPermissions: Readonly<PermissionsBitField> | null): boolean {
  return Boolean(
    memberPermissions?.has(PermissionFlagsBits.CreateGuildExpressions) ||
    memberPermissions?.has(PermissionFlagsBits.ManageGuildExpressions)
  );
}

function pushError(stats: CopyStats, label: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  stats.failed++;
  if (stats.errors.length < 5) {
    stats.errors.push(`${label}: ${reason}`);
  }
}

function safeEmojiName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 32);
  return normalized.length >= 2 ? normalized : "copied";
}

function safeStickerName(name: string): string {
  const normalized = name.trim().slice(0, 30);
  return normalized.length >= 2 ? normalized : "copied";
}

function buildProgress(sourceGuild: Guild, targetGuild: Guild, emoji: CopyStats, sticker: CopyStats): string {
  return [
    `コピー中: ${sourceGuild.name} -> ${targetGuild.name}`,
    `絵文字: 作成 ${emoji.copied} / スキップ ${emoji.skipped} / 失敗 ${emoji.failed}`,
    `スタンプ: 作成 ${sticker.copied} / スキップ ${sticker.skipped} / 失敗 ${sticker.failed}`,
  ].join("\n");
}

function makeStickerRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("stnp_sticker_copy")
      .setLabel("コピー")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("stnp_sticker_skip")
      .setLabel("スキップ")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("stnp_sticker_stop")
      .setLabel("中止")
      .setStyle(ButtonStyle.Danger)
  );
}

function makeStickerEmbed(sticker: Sticker, targetName: string, index: number, total: number): EmbedBuilder {
  const description = [
    `コピー名: \`${targetName}\``,
    sticker.description ? `説明: ${sticker.description}` : null,
    sticker.tags ? `タグ: ${sticker.tags}` : null,
    `[画像を開く](${sticker.url})`,
  ].filter(Boolean).join("\n");

  return new EmbedBuilder()
    .setTitle(sticker.name)
    .setDescription(description)
    .setImage(sticker.url)
    .setFooter({ text: `スタンプ ${index}/${total}` });
}

async function copyEmojis(
  sourceGuild: Guild,
  targetGuild: Guild,
  sourceEmojis: GuildEmoji[],
  status: Message,
  stickerStats: CopyStats,
  executorTag: string
): Promise<CopyStats> {
  const stats = blankStats();
  const targetEmojis = await targetGuild.emojis.fetch();
  const usedNames = new Set(targetEmojis.map((emoji) => emoji.name.toLowerCase()));

  for (const emoji of sourceEmojis) {
    const targetName = safeEmojiName(emoji.name);
    if (usedNames.has(targetName.toLowerCase())) {
      stats.skipped++;
      continue;
    }
    usedNames.add(targetName.toLowerCase());

    try {
      await targetGuild.emojis.create({
        attachment: emoji.imageURL({
          extension: emoji.animated ? "gif" : "png",
          size: 128,
        }),
        name: targetName,
        reason: `Copied by ${executorTag} from ${sourceGuild.name} (${sourceGuild.id})`,
      });
      stats.copied++;
    } catch (error) {
      pushError(stats, emoji.name, error);
    }

    const processed = stats.copied + stats.skipped + stats.failed;
    if (processed % PROGRESS_INTERVAL === 0) {
      await status.edit(buildProgress(sourceGuild, targetGuild, stats, stickerStats)).catch(() => {});
    }
  }

  return stats;
}

async function askStickerDecision(
  status: Message,
  userId: string,
  sourceGuild: Guild,
  targetGuild: Guild,
  emojiStats: CopyStats,
  stickerStats: CopyStats,
  sticker: Sticker,
  targetName: string,
  index: number,
  total: number,
  targetStickerCount: number
): Promise<StickerDecision> {
  await status.edit({
    content: `${buildProgress(sourceGuild, targetGuild, emojiStats, stickerStats)}\nコピー先の現在のスタンプ数: ${targetStickerCount}\n\nこのスタンプをコピーしますか？`,
    embeds: [makeStickerEmbed(sticker, targetName, index, total)],
    components: [makeStickerRow()],
  });

  const filter = (interaction: ButtonInteraction) => {
    if (!interaction.customId.startsWith("stnp_sticker_")) return false;
    if (interaction.user.id === userId) return true;

    interaction.reply({
      content: "この選択はコマンドを実行した人だけが操作できます。",
      ephemeral: true,
    }).catch(() => {});
    return false;
  };

  try {
    const interaction = await status.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter,
      time: STICKER_SELECT_TIMEOUT_MS,
    });
    await interaction.deferUpdate();

    if (interaction.customId === "stnp_sticker_copy") return "copy";
    if (interaction.customId === "stnp_sticker_skip") return "skip";
    return "stop";
  } catch {
    return "timeout";
  }
}

async function copyStickers(
  sourceGuild: Guild,
  targetGuild: Guild,
  sourceStickers: Sticker[],
  status: Message,
  emojiStats: CopyStats,
  userId: string,
  executorTag: string
): Promise<CopyStats> {
  const stats = blankStats();
  const targetStickers = await targetGuild.stickers.fetch();
  const usedNames = new Set(targetStickers.map((sticker) => sticker.name.toLowerCase()));

  for (const [index, sticker] of sourceStickers.entries()) {
    const targetName = safeStickerName(sticker.name);
    if (usedNames.has(targetName.toLowerCase())) {
      stats.skipped++;
      continue;
    }

    const decision = await askStickerDecision(
      status,
      userId,
      sourceGuild,
      targetGuild,
      emojiStats,
      stats,
      sticker,
      targetName,
      index + 1,
      sourceStickers.length,
      targetStickers.size + stats.copied
    );

    if (decision === "timeout") {
      stats.timedOut = true;
      break;
    }
    if (decision === "stop") {
      stats.stopped = true;
      break;
    }
    if (decision === "skip") {
      stats.skipped++;
      continue;
    }

    usedNames.add(targetName.toLowerCase());
    await status.edit({
      content: `${buildProgress(sourceGuild, targetGuild, emojiStats, stats)}\n\nコピーしています: ${sticker.name}`,
      embeds: [makeStickerEmbed(sticker, targetName, index + 1, sourceStickers.length)],
      components: [],
    });

    try {
      await targetGuild.stickers.create({
        file: sticker.url,
        name: targetName,
        tags: sticker.tags ?? "white_check_mark",
        description: sticker.description ?? "",
        reason: `Copied by ${executorTag} from ${sourceGuild.name} (${sourceGuild.id})`,
      });
      stats.copied++;
    } catch (error) {
      pushError(stats, sticker.name, error);
    }
  }

  await status.edit({
    content: buildProgress(sourceGuild, targetGuild, emojiStats, stats),
    embeds: [],
    components: [],
  }).catch(() => {});
  return stats;
}

const stnp = {
  name: "stnp",
  async execute(message: Message, args: string[]): Promise<void> {
    if (!message.guild || !message.member) return;

    const channel = message.channel as TextChannel;
    const sourceGuildId = args[0];

    if (!sourceGuildId || !SNOWFLAKE_RE.test(sourceGuildId)) {
      await channel.send("使い方: `o.stnp <コピー元サーバーID>`");
      return;
    }

    if (!hasExpressionPermission(message.member.permissions)) {
      await channel.send("このコマンドを使うには、このサーバーで「絵文字とスタンプを作成」または「絵文字とスタンプを管理」権限が必要です。");
      return;
    }

    const targetGuild = message.guild;
    const botMember = targetGuild.members.me ?? await targetGuild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.CreateGuildExpressions)) {
      await channel.send("bot にこのサーバーで「絵文字とスタンプを作成」権限を付けてください。");
      return;
    }

    let sourceGuild: Guild;
    try {
      sourceGuild = await message.client.guilds.fetch(sourceGuildId);
    } catch {
      await channel.send("コピー元サーバーが見つかりません。bot がそのサーバーに参加しているか確認してください。");
      return;
    }

    if (sourceGuild.id === targetGuild.id) {
      await channel.send("コピー元とコピー先が同じサーバーです。別のサーバーIDを指定してください。");
      return;
    }

    const status = await channel.send(`コピー準備中: ${sourceGuild.name} -> ${targetGuild.name}`);

    try {
      const [sourceEmojiCollection, sourceStickerCollection] = await Promise.all([
        sourceGuild.emojis.fetch(),
        sourceGuild.stickers.fetch(),
      ]);
      const sourceEmojis = [...sourceEmojiCollection.values()].filter((emoji) => emoji.available !== false);
      const sourceStickers = [...sourceStickerCollection.values()].filter((sticker) => sticker.available !== false);

      if (sourceEmojis.length === 0 && sourceStickers.length === 0) {
        await status.edit("コピー元に利用可能な絵文字・スタンプがありません。");
        return;
      }

      let emojiStats = blankStats();
      let stickerStats = blankStats();
      await status.edit(buildProgress(sourceGuild, targetGuild, emojiStats, stickerStats));

      emojiStats = await copyEmojis(
        sourceGuild,
        targetGuild,
        sourceEmojis,
        status,
        stickerStats,
        message.author.tag
      );
      stickerStats = await copyStickers(
        sourceGuild,
        targetGuild,
        sourceStickers,
        status,
        emojiStats,
        message.author.id,
        message.author.tag
      );

      const details = [...emojiStats.errors, ...stickerStats.errors];
      const errorText = details.length > 0
        ? `\n失敗例:\n${details.map((detail) => `- ${detail}`).join("\n")}`
        : "";
      const stoppedText = stickerStats.stopped
        ? "\nスタンプの選択を中止しました。"
        : stickerStats.timedOut
          ? "\nスタンプの選択がタイムアウトしたため、残りは処理していません。"
          : "";

      await status.edit({
        content: `${buildProgress(sourceGuild, targetGuild, emojiStats, stickerStats)}\n完了しました。${stoppedText}${errorText}`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await status.edit({
        content: `コピー処理に失敗しました: ${reason}`,
        embeds: [],
        components: [],
      });
    }
  },
};

module.exports = stnp;
