import { tutDetailPageUrl } from "../../config/tut";
import { resolveEnemyDisplayName } from "./domain";
import { TutSearchMatch } from "./types";

export const TUT_NUMBER_EMOJIS = [
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
export const TUT_PREVIOUS_PAGE_EMOJI = "◀️";
export const TUT_NEXT_PAGE_EMOJI = "▶️";

export function formatEnemyLabel(match: TutSearchMatch): string {
  return `${match.enemy.id} ${resolveEnemyDisplayName(match)}`;
}

export function formatEnemyDetailUrl(id: number): string {
  return `${tutDetailPageUrl}&unit=${id}`;
}

export function formatEnemyDetail(match: TutSearchMatch): string {
  return `${formatEnemyLabel(match)}\n${formatEnemyDetailUrl(match.enemy.id)}`;
}

function formatEnemyHeader(
  query: string,
  startIndex: number,
  endIndex: number,
  total: number,
  pageIndex?: number,
  pageCount?: number,
): string {
  const page = pageIndex === undefined || pageCount === undefined
    ? ""
    : `（${pageIndex + 1}/${pageCount}ページ）`;
  return `敵ユニット「${query}」検索結果 ${startIndex + 1}～${endIndex}/${total}${page}`;
}

export function formatEnemySelection(
  query: string,
  matches: readonly TutSearchMatch[],
  footer: string,
): string {
  const lines = matches.map(
    (match, index) => `${TUT_NUMBER_EMOJIS[index]} ${formatEnemyLabel(match)}`,
  );
  return [
    formatEnemyHeader(query, 0, matches.length, matches.length),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}

export function formatEnemyPage(
  query: string,
  matches: readonly TutSearchMatch[],
  pageIndex: number,
  pageSize: number,
  footer: string,
  includePageCount: boolean,
): string {
  const startIndex = pageIndex * pageSize;
  const endIndex = Math.min(startIndex + pageSize, matches.length);
  const pageCount = Math.ceil(matches.length / pageSize);
  const lines = matches.slice(startIndex, endIndex).map(formatEnemyLabel);
  return [
    formatEnemyHeader(
      query,
      startIndex,
      endIndex,
      matches.length,
      includePageCount ? pageIndex : undefined,
      includePageCount ? pageCount : undefined,
    ),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}
