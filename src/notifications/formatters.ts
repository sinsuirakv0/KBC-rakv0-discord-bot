import { DetectionEvent } from "./types";

export function formatDetection(event: DetectionEvent, includeTypes = true): string {
  const date = new Date(Date.parse(event.detectedAt) + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`
    + `(${"日月火水木金土"[date.getUTCDay()]}) ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const title = event.category === "skd" ? "**スケジュール更新を検知**"
    : event.category === "ad" ? "adの更新を検知" : "popup_noticeの更新を検知";
  const lines = [title, `検知時刻: ${timestamp}`];
  if (event.category === "skd" && includeTypes && event.types.length) lines.push(`種類: ${event.types.join(",")}`);
  return lines.join("\n");
}
