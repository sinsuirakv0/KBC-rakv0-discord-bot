export const notificationCategories = ["skd", "ad", "notice"] as const;
export type NotificationCategory = typeof notificationCategories[number];
export const scheduleTypes = ["gatya", "sale", "item"] as const;
export type ScheduleType = typeof scheduleTypes[number];

export interface DetectionEvent {
  version: 1;
  eventId: string;
  category: NotificationCategory;
  phase: "detected" | "types" | "ready";
  detectedAt: string;
  types: ScheduleType[];
  source?: ScheduleSource;
}

export interface ScheduleSource {
  beforeRef: string;
  afterRef: string;
  files: Partial<Record<ScheduleType, { path: string; hash: string }>>;
}

export interface Subscription {
  guildId: string;
  channelId: string;
  category: NotificationCategory;
}

export interface DeliveryMessage {
  status: "pending" | "attempting" | "sent";
  attemptId?: string;
  messageId?: string;
  content?: string;
}

export interface DeliveryRecord extends DeliveryMessage {
  channelId: string;
  followUps?: DeliveryMessage[];
}

export interface EventRecord {
  schemaVersion: 1;
  event: DetectionEvent;
  deliveries: DeliveryRecord[];
  detailContents?: string[];
}

export interface NotificationTransport {
  send(channelId: string, content: string, nonce: string): Promise<string>;
  edit(channelId: string, messageId: string, content: string): Promise<void>;
}
