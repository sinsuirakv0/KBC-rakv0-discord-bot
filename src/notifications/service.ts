import { StorageError } from "../storage/types";
import { createHash, randomUUID } from "node:crypto";
import { formatDetection } from "./formatters";
import { NotificationStore } from "./store";
import { DetectionEvent, NotificationTransport, scheduleTypes } from "./types";

export function createDetectionService(store: NotificationStore, transport: NotificationTransport,
  buildDetails?: (event: DetectionEvent) => Promise<string[]>) {
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
        if (event.source) {
          if (record.event.source && JSON.stringify(record.event.source) !== JSON.stringify(event.source)) throw new Error("Schedule source mismatch");
          record.event.source = event.source;
          record.event.phase = "ready";
        }
        const knownTypes = record.event.types;
        record.event.types = scheduleTypes.filter(type => knownTypes.includes(type) || event.types.includes(type));
      }
      return record;
    });
    let details: Promise<string[]> | undefined;
    const getDetails = () => details ??= (async () => {
      if (current.detailContents) return current.detailContents;
      if (!buildDetails) throw new Error("Schedule details unavailable");
      const contents = await buildDetails(current.event);
      const saved = await store.update(event.eventId, record => {
        if (!record) throw new Error("Missing event record");
        record.detailContents ??= contents;
        return record;
      });
      return saved.detailContents!;
    })();
    const outcomes = await Promise.allSettled(current.deliveries.filter(delivery => subscriptions.some(item =>
      item.channelId === delivery.channelId && item.category === event.category)).map(async delivery => {
      const checkpoint = (index?: number, claim = false) => store.update(event.eventId, record => {
        if (!record) throw new Error("Missing event record");
        const saved = record.deliveries.find(item => item.channelId === delivery.channelId)!;
        if (index !== undefined) saved.followUps ??= record.detailContents!.map(() => ({ status: "pending" }));
        const target = index === undefined ? saved : saved.followUps![index];
        if (claim && target.status !== "pending") throw new StorageError(target.status === "attempting" ? "reconciliation-required" : "delivery-already-updated");
        const { status, attemptId, messageId, content } = index === undefined ? delivery : delivery.followUps![index];
        Object.assign(target, { status, attemptId, messageId, content });
        return record;
      });
      if (!delivery.messageId) {
        if (delivery.status === "attempting") throw new StorageError("reconciliation-required");
        delivery.status = "attempting";
        delivery.attemptId = randomUUID();
        await checkpoint(undefined, true);
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
      if (current.event.source) {
        const contents = await getDetails();
        delivery.followUps ??= contents.map(() => ({ status: "pending" as const }));
        for (const [index, detail] of contents.entries()) {
          const part = delivery.followUps[index];
          if (part.status === "sent") continue;
          if (part.status === "attempting") throw new StorageError("reconciliation-required");
          part.status = "attempting";
          part.attemptId = randomUUID();
          await checkpoint(index, true);
          const nonce = createHash("sha256").update(`${event.eventId}:${delivery.channelId}:detail:${index}`).digest("hex").slice(0, 24);
          part.messageId = await transport.send(delivery.channelId, detail, nonce);
          part.content = detail;
          part.status = "sent";
          await checkpoint(index);
        }
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
