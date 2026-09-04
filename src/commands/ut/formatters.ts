import { utDetailPageBaseUrl } from "../../config/ut";
import { UtSearchMatch } from "./types";

export const NUMBER_EMOJIS = [
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
export const PREVIOUS_PAGE_EMOJI = "◀️";
export const NEXT_PAGE_EMOJI = "▶️";

function matchAnnotation(match: UtSearchMatch): string {
  if (match.source.kind === "alias") return " (別称でヒット)";
  if (match.source.kind !== "form" || match.source.formIndex === 0) return "";
  return ` (${["第一", "第二", "第三", "第四"][match.source.formIndex]}形態名でヒット)`;
}

export function formatMatchLabel(match: UtSearchMatch): string {
  return `${match.unit.id} ${match.unit.forms[0].name}${matchAnnotation(match)}`;
}

export function formatDetailUrl(id: string): string {
  return `${utDetailPageBaseUrl}/u${id}.html?cc=ja&unit=${id}`;
}

export function formatDetailResult(match: UtSearchMatch): string {
  return `${formatMatchLabel(match)}\n${formatDetailUrl(match.unit.id)}`;
}

function formatRangeHeader(
  query: string,
  startIndex: number,
  endIndex: number,
  total: number,
  page?: number,
  pageCount?: number,
): string {
  const pageText = page && pageCount ? `（${page}/${pageCount}ページ）` : "";
  return `味方キャラ「${query}」検索結果 ${startIndex + 1}～${endIndex}/${total}${pageText}`;
}

export function formatSelectionList(
  query: string,
  matches: readonly UtSearchMatch[],
  footer: string,
): string {
  const lines = matches.map(
    (match, index) => `${NUMBER_EMOJIS[index]} ${formatMatchLabel(match)}`,
  );
  return [
    formatRangeHeader(query, 0, matches.length, matches.length),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}

export function formatResultPage(
  query: string,
  matches: readonly UtSearchMatch[],
  pageIndex: number,
  pageSize: number,
  footer: string,
  includePageCount: boolean,
): string {
  const startIndex = pageIndex * pageSize;
  const endIndex = Math.min(startIndex + pageSize, matches.length);
  const pageCount = Math.ceil(matches.length / pageSize);
  const lines = matches
    .slice(startIndex, endIndex)
    .map((match) => formatMatchLabel(match));
  return [
    formatRangeHeader(
      query,
      startIndex,
      endIndex,
      matches.length,
      includePageCount ? pageIndex + 1 : undefined,
      includePageCount ? pageCount : undefined,
    ),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}
