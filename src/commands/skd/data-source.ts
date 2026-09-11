import { createScheduleDataSource, ScheduleComparison } from "../../notifications/skd/data-source";
import { DetectionEvent, scheduleTypes } from "../../notifications/types";
import { selectScheduleUpdate } from "./domain";

export function createSkdDataSource(source: Pick<ReturnType<typeof createScheduleDataSource>, "readHistorySnapshot" | "buildDetails"> = createScheduleDataSource()) {
  return {
    async load(date?: string) {
      const { ref, files } = await source.readHistorySnapshot();
      const update = selectScheduleUpdate(files, date);
      if (!update) return undefined;
      const comparisons = scheduleTypes.flatMap<ScheduleComparison>(type => {
        const after = update.files.filter(file => file.type === type).at(-1);
        if (!after) return [];
        const before = files.filter(file => file.type === type && file.timestamp < update.timestamp)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        return [{ type, after: { ref, path: after.path }, ...(before ? { before: { ref, path: before.path } } : {}) }];
      });
      const event: DetectionEvent = {
        version: 1, eventId: `skd-history:${update.timestamp}`, category: "skd", phase: "types",
        detectedAt: new Date(update.timestamp * 1000).toISOString(), types: comparisons.map(comparison => comparison.type),
      };
      return { event, contents: await source.buildDetails(comparisons, event.detectedAt), initialTypes: comparisons.filter(comparison => !comparison.before).map(comparison => comparison.type) };
    },
  };
}
