import { CommandDefinition } from "../types";
import { formatDetection } from "../../notifications/formatters";
import { createSkdDataSource } from "./data-source";
import { parseSkdDate } from "./parsers";

export function createSkdCommand(dataSource = createSkdDataSource()): CommandDefinition {
  return {
    name: "skd",
    guildOnly: true,
    async execute(context, args): Promise<void> {
      let date: string | undefined;
      try { date = parseSkdDate(args); }
      catch { await context.reply("使い方: o.skd / o.skd 2026/07/30 / o.skd 2026 07 30"); return; }
      let update: Awaited<ReturnType<typeof dataSource.load>>;
      try { update = await dataSource.load(date); }
      catch { await context.reply("スケジュール更新の取得に失敗しました。"); return; }
      if (!update) { await context.reply("保存済みのスケジュール更新はありません。"); return; }
      const note = update.initialTypes.length ? `\n初回保存分（比較元なし）: ${update.initialTypes.join(",")}` : "";
      await context.reply(formatDetection(update.event, true, "検知時刻（TSV保存時刻）") + note);
      for (const content of update.contents) await context.reply(content);
    },
  };
}

export const skdCommand = createSkdCommand();
