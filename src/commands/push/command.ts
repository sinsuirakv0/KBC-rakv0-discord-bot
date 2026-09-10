import { NotificationStore } from "../../notifications/store";
import { getNotificationStore } from "../../storage/runtime";
import { CommandContext, CommandDefinition } from "../types";
import { parsePushRequest } from "./parsers";

export interface PushCommandDependencies {
  getStore(): Pick<NotificationStore, "setSubscription">;
  canConfigure(context: CommandContext): Promise<boolean | undefined>;
}

export function createPushCommand(dependencies: PushCommandDependencies = {
  getStore: getNotificationStore,
  // Bot管理者・健康維持メンテナーの権限仕様が決まってから接続する。
  canConfigure: async () => undefined,
}): CommandDefinition {
  return {
    name: "push",
    guildOnly: true,
    async execute(context, args): Promise<void> {
      const request = parsePushRequest(args);
      if (!request) {
        await context.reply("使い方: o.push skd / o.push ad / o.push notice（解除は末尾に off）");
        return;
      }
      const permission = await dependencies.canConfigure(context);
      if (permission !== true) {
        await context.reply(permission === undefined
          ? "通知先設定は、Bot管理者・健康維持メンテナーの権限機能を準備中です。"
          : "通知先の変更にはBot管理者・健康維持メンテナー権限が必要です。");
        return;
      }
      if (!context.guildId || !context.channelId) return;
      await dependencies.getStore().setSubscription({
        guildId: context.guildId,
        channelId: context.channelId,
        category: request.category,
      }, request.enabled);
      await context.reply(`${request.category}の更新通知をこのチャンネルで${request.enabled ? "登録" : "解除"}しました。`);
    },
  };
}

export const pushCommand = createPushCommand();
