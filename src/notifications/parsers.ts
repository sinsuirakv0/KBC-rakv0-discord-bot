import { DetectionEvent, notificationCategories, scheduleTypes } from "./types";

export function parseDetectionEvent(value: unknown): DetectionEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid event");
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || typeof input.eventId !== "string"
    || !/^[A-Za-z0-9:_-]{1,160}$/.test(input.eventId)
    || !notificationCategories.includes(input.category as DetectionEvent["category"])
    || !["detected", "types"].includes(input.phase as string)
    || typeof input.detectedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.detectedAt)
    || !Number.isFinite(Date.parse(input.detectedAt))
    || !Array.isArray(input.types)
    || input.types.some(type => !scheduleTypes.includes(type))) {
    throw new Error("Invalid event");
  }
  if (input.category !== "skd" && (input.phase !== "detected" || input.types.length !== 0)) {
    throw new Error("Invalid control event");
  }
  if (input.phase === "types" && input.types.length === 0) throw new Error("Missing schedule types");
  return {
    version: 1,
    eventId: input.eventId,
    category: input.category as DetectionEvent["category"],
    phase: input.phase as DetectionEvent["phase"],
    detectedAt: new Date(input.detectedAt).toISOString(),
    types: scheduleTypes.filter(type => (input.types as unknown[]).includes(type)),
  };
}
