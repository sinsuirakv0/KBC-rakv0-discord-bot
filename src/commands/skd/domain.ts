import { ScheduleHistoryFile } from "../../notifications/skd/data-source";
import { skdHistoryGroupSeconds } from "../../config/skd";

interface ScheduleUpdate { timestamp: number; files: ScheduleHistoryFile[]; }

function updateDate(timestamp: number): string {
  return new Date(timestamp * 1000 + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function selectScheduleUpdate(files: readonly ScheduleHistoryFile[], date?: string): ScheduleUpdate | undefined {
  const updates: ScheduleUpdate[] = [];
  for (const file of [...files].sort((a, b) => a.timestamp - b.timestamp)) {
    const previous = updates.at(-1);
    if (previous && file.timestamp - previous.timestamp <= skdHistoryGroupSeconds) previous.files.push(file);
    else updates.push({ timestamp: file.timestamp, files: [file] });
  }
  if (!date) return updates.at(-1);
  const target = Date.parse(date);
  return updates.sort((a, b) => {
    const first = updateDate(a.timestamp);
    const second = updateDate(b.timestamp);
    return Math.abs(Date.parse(first) - target) - Math.abs(Date.parse(second) - target)
      || first.localeCompare(second) || b.timestamp - a.timestamp;
  })[0];
}
