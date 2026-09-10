import { createHash } from "node:crypto";
import { JsonStore } from "../storage/json-store";
import { GuildSettingsStore } from "../storage/guild-settings";
import { StorageError } from "../storage/types";
import { parseDetectionEvent } from "./parsers";
import { DeliveryMessage, EventRecord, Subscription } from "./types";

function validMessage(item: DeliveryMessage): boolean {
  return Boolean(item && ["pending", "attempting", "sent"].includes(item.status)
    && (item.attemptId === undefined || typeof item.attemptId === "string" && /^[a-f0-9-]{36}$/.test(item.attemptId))
    && (item.messageId === undefined || typeof item.messageId === "string" && /^\d+$/.test(item.messageId))
    && (item.status !== "sent" || item.messageId)
    && (item.content === undefined || typeof item.content === "string"));
}

function parseRecord(value: unknown): EventRecord {
  const record = value as EventRecord;
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.deliveries)) throw new StorageError("invalid-event-record");
  record.event = parseDetectionEvent(record.event);
  for (const item of record.deliveries) {
    if (!item || typeof item.channelId !== "string" || !/^\d+$/.test(item.channelId)
      || !validMessage(item) || (item.followUps !== undefined && (!Array.isArray(item.followUps)
        || item.followUps.length !== 5 || item.followUps.some(part => !validMessage(part))))) throw new StorageError("invalid-delivery");
  }
  if (record.detailContents !== undefined && (!Array.isArray(record.detailContents) || record.detailContents.length !== 5
    || record.detailContents.some(content => typeof content !== "string" || content.length > 2000))) throw new StorageError("invalid-details");
  return record;
}
export class NotificationStore {
  constructor(private readonly store: JsonStore, readonly guilds: GuildSettingsStore) {}
  update(eventId: string, change: (record: EventRecord | undefined) => EventRecord): Promise<EventRecord> {
    const path = `notifications/events/${createHash("sha256").update(eventId).digest("hex")}.json`;
    return this.store.update(path, parseRecord, record => {
      if (record && record.event.eventId !== eventId) throw new StorageError("event-id-mismatch");
      return change(record);
    });
  }
  setSubscription(subscription: Subscription, enabled: boolean): Promise<void> {
    return this.guilds.setSubscription(subscription, enabled);
  }
}
