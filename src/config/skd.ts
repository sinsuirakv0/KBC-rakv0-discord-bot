export const skdSourceBaseUrl = "https://raw.githubusercontent.com/sinsuirakv0/KBC-rakv0-event";
export const skdHttpTimeoutMs = 15_000;
export const skdMaxDocumentBytes = 4 * 1024 * 1024;
export const skdDisplayLimit = 5;

export function skdHistoryUrl(rawPaths: string[]): string {
  const url = new URL(process.env.EVENT_SITE_URL || "https://kbc-rakv0-event.vercel.app/");
  const timestamps = rawPaths.map(path => Number(/_(\d+)\.tsv$/.exec(path)?.[1])).filter(Number.isFinite);
  url.searchParams.set("tab", "history");
  if (timestamps.length) url.searchParams.set("tsv", String(Math.max(...timestamps)));
  url.searchParams.set("type", "all");
  return url.toString();
}
