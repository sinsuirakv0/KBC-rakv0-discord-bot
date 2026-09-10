import { StorageError } from "../storage/types";
import { createHash } from "node:crypto";
import { formatDetection } from "./formatters";
import { NotificationStore } from "./store";
import { DetectionEvent, NotificationTransport, scheduleTypes } from "./types";

export function createDetectionService(store: NotificationStore, transport: NotificationTransport) {
  const queues = new Map<string, Promise<void>>();
  async function deliver(event: DetectionEvent): Promise<void> {
    const subscriptions = store.guilds.subscriptions();
    const current = await store.update(event.eventId, record => {
      if (record && record.event.category !== event.category) throw new Error("Event category mismatch");
      if (!record) {
        record = {
          schemaVersion: 1,
          event,
          deliveries: subscriptions.filter(item => item.category === event.category)
            .map(item => ({ channelId: item.channelId, status: "pending" })),
        };
      } else {
        const knownTypes = record.event.types;
        record.event.types = scheduleTypes.filter(type => knownTypes.includes(type) || event.types.includes(type));
      }
      return record;
    });
    const outcomes = await Promise.allSettled(current.deliveries.filter(delivery => subscriptions.some(item =>
      item.channelId === delivery.channelId && item.category === event.category)).map(async delivery => {
      const checkpoint = () => store.update(event.eventId, record => {
        if (!record) throw new Error("Missing event record");
        Object.assign(record.deliveries.find(item => item.channelId === delivery.channelId)!, delivery);
        return record;
      });
      if (!delivery.messageId) {
        if (delivery.status === "attempting") throw new StorageError("reconciliation-required");
        delivery.status = "attempting";
        await checkpoint();
        const content = formatDetection(current.event, false);
        const nonce = createHash("sha256").update(`${event.eventId}:${delivery.channelId}`).digest("hex").slice(0, 24);
        delivery.messageId = await transport.send(delivery.channelId, content, nonce);
        delivery.status = "sent";
        delivery.content = content;
        await checkpoint();
      }
      const content = formatDetection(current.event);
      if (delivery.content !== content) {
        await transport.edit(delivery.channelId, delivery.messageId, content);
        delivery.content = content;
        await checkpoint();
      }
    }));
    if (outcomes.some(result => result.status === "rejected" && result.reason instanceof StorageError && result.reason.code === "reconciliation-required")) throw new StorageError("reconciliation-required");
    if (outcomes.some(result => result.status === "rejected")) throw new Error("Notification delivery failed");
  }

  return (event: DetectionEvent): Promise<void> => {
    const task = (queues.get(event.eventId) ?? Promise.resolve()).then(() => deliver(event));
    const settled = task.then(() => undefined, () => undefined);
    queues.set(event.eventId, settled);
    void settled.then(() => { if (queues.get(event.eventId) === settled) queues.delete(event.eventId); });
    return task;
  };
}
