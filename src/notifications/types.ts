export const notificationCategories = ["skd", "ad", "notice"] as const;
export type NotificationCategory = typeof notificationCategories[number];
export const scheduleTypes = ["gatya", "sale", "item"] as const;
export type ScheduleType = typeof scheduleTypes[number];

export interface DetectionEvent {
  version: 1;
  eventId: string;
  category: NotificationCategory;
  phase: "detected" | "types";
  detectedAt: string;
  types: ScheduleType[];
}

export interface Subscription {
  guildId: string;
  channelId: string;
  category: NotificationCategory;
}

export interface DeliveryRecord {
  status: "pending" | "attempting" | "sent";
  channelId: string;
  messageId?: string;
  content?: string;
}

export interface EventRecord {
  schemaVersion: 1;
  event: DetectionEvent;
  deliveries: DeliveryRecord[];
}

export interface NotificationTransport {
  send(channelId: string, content: string, nonce: string): Promise<string>;
  edit(channelId: string, messageId: string, content: string): Promise<void>;
}
