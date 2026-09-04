import { stDetailPageBaseUrl } from "../../config/st";
import { StageSearchEntry } from "./types";

export const ST_NUMBER_EMOJIS = [
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
export const ST_PREVIOUS_PAGE_EMOJI = "◀️";
export const ST_NEXT_PAGE_EMOJI = "▶️";

export function formatStageLabel(entry: StageSearchEntry): string {
  return `${entry.displayId} ${entry.displayName}`;
}

export function formatStageUrl(entry: StageSearchEntry): string {
  const base = `${stDetailPageBaseUrl}?cc=ja&type=${encodeURIComponent(entry.jdbType)}&map=${entry.jdbMap}`;
  return entry.kind === "stage" ? `${base}&stage=${entry.stageIndex}` : base;
}

export function formatStageDetail(entry: StageSearchEntry): string {
  return `${formatStageLabel(entry)}\n${formatStageUrl(entry)}`;
}

function formatHeader(
  query: string,
  total: number,
  pageIndex?: number,
  pageCount?: number,
): string {
  const page = pageIndex === undefined || pageCount === undefined
    ? ""
    : `・${pageIndex + 1}/${pageCount}ページ`;
  return `ステージ「${query}」検索結果（${total}件${page}）`;
}

export function formatStageSelection(
  query: string,
  matches: readonly StageSearchEntry[],
  footer: string,
): string {
  const lines = matches.map(
    (entry, index) => `${ST_NUMBER_EMOJIS[index]} ${formatStageLabel(entry)}`,
  );
  return [
    formatHeader(query, matches.length),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}

export function formatStagePage(
  query: string,
  matches: readonly StageSearchEntry[],
  pageIndex: number,
  pageSize: number,
  footer: string,
  includePageCount: boolean,
): string {
  const pageCount = Math.ceil(matches.length / pageSize);
  const lines = matches
    .slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)
    .map(formatStageLabel);
  return [
    formatHeader(
      query,
      matches.length,
      includePageCount ? pageIndex : undefined,
      includePageCount ? pageCount : undefined,
    ),
    `\`\`\`text\n${lines.join("\n")}\n\`\`\``,
    footer,
  ].join("\n");
}
