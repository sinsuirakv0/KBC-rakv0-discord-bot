import { InteractiveCommandOutput } from "../types";

export interface AssetFileOption {
  relativePath: string;
  label: string;
}

const NUMBER_EMOJIS = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
  "9️⃣",
] as const;
const PREVIOUS_PAGE_EMOJI = "◀️";
const NEXT_PAGE_EMOJI = "▶️";
const PAGE_SIZE = NUMBER_EMOJIS.length;

function pageEmojis(pageIndex: number, pageCount: number, itemCount: number): string[] {
  const emojis: string[] = [...NUMBER_EMOJIS.slice(0, itemCount)];
  if (pageIndex > 0) emojis.push(PREVIOUS_PAGE_EMOJI);
  if (pageIndex < pageCount - 1) emojis.push(NEXT_PAGE_EMOJI);
  return emojis;
}

function formatFilePage(
  title: string,
  options: readonly AssetFileOption[],
  pageIndex: number,
  footer: string,
): string {
  const pageCount = Math.ceil(options.length / PAGE_SIZE);
  const startIndex = pageIndex * PAGE_SIZE;
  const page = options.slice(startIndex, startIndex + PAGE_SIZE);
  const lines = page.map(
    (option, index) => `${NUMBER_EMOJIS[index]} ${option.relativePath} (${option.label})`,
  );
  return [
    `${title} ${startIndex + 1}～${startIndex + page.length}/${options.length}（${pageIndex + 1}/${pageCount}ページ）`,
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}

export async function selectAssetFile(
  title: string,
  options: readonly AssetFileOption[],
  output: InteractiveCommandOutput,
  timeoutMs: number,
): Promise<AssetFileOption | undefined> {
  const pageCount = Math.ceil(options.length / PAGE_SIZE);
  let pageIndex = 0;
  const activeFooter = "数字のリアクションでファイルを選択してください。";
  const message = await output.send(formatFilePage(title, options, pageIndex, activeFooter));

  while (true) {
    const page = options.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
    const emojis = pageEmojis(pageIndex, pageCount, page.length);
    for (const emoji of emojis) await message.react(emoji);
    const selectedEmoji = await message.waitForUserReaction(
      emojis,
      output.userId,
      timeoutMs,
    );
    if (!selectedEmoji) {
      await message.clearReactions();
      await message.edit(formatFilePage(
        title,
        options,
        pageIndex,
        "ファイル選択受付は終了しました。",
      ));
      return undefined;
    }

    if (selectedEmoji === PREVIOUS_PAGE_EMOJI || selectedEmoji === NEXT_PAGE_EMOJI) {
      await message.clearReactions();
      pageIndex += selectedEmoji === PREVIOUS_PAGE_EMOJI ? -1 : 1;
      await message.edit(formatFilePage(title, options, pageIndex, activeFooter));
      continue;
    }

    const selected = page[NUMBER_EMOJIS.indexOf(
      selectedEmoji as typeof NUMBER_EMOJIS[number],
    )];
    if (!selected) continue;
    await message.clearReactions();
    await message.edit(formatFilePage(
      title,
      options,
      pageIndex,
      `選択済み: ${selected.relativePath}`,
    ));
    return selected;
  }
}
