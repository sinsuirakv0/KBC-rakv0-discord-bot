import { notificationCategories, Subscription } from "../notifications/types";
import { JsonStore } from "./json-store";
import { StorageError } from "./types";

interface GuildSettings {
  schemaVersion: 1;
  guildId: string;
  healthMaintainerRoleId: string | null;
  subscriptions: Subscription[];
}
function parseSettings(value: unknown): GuildSettings {
  const item = value as GuildSettings;
  if (!item || item.schemaVersion !== 1 || typeof item.guildId !== "string" || !/^\d+$/.test(item.guildId)
    || !(item.healthMaintainerRoleId === null || typeof item.healthMaintainerRoleId === "string" && /^\d+$/.test(item.healthMaintainerRoleId))
    || !Array.isArray(item.subscriptions) || item.subscriptions.some(s => !s || s.guildId !== item.guildId
      || typeof s.channelId !== "string" || !/^\d+$/.test(s.channelId) || !notificationCategories.includes(s.category))) {
    throw new StorageError("invalid-guild-settings");
  }
  return item;
}
export class GuildSettingsStore {
  private settings = new Map<string, GuildSettings>();
  constructor(private readonly store: JsonStore) {}
  async restore(): Promise<void> {
    const settings = new Map<string, GuildSettings>();
    for (const path of await this.store.list("config/guilds")) {
      const item = await this.store.read(path, parseSettings);
      if (!item || path !== this.path(item.guildId)) throw new StorageError("invalid-guild-path");
      settings.set(item.guildId, item);
    }
    this.settings = settings;
  }
  private path(guildId: string): string {
    if (!/^\d+$/.test(guildId)) throw new StorageError("invalid-guild-id");
    return `config/guilds/${guildId}.json`;
  }
  subscriptions(): Subscription[] {
    return structuredClone([...this.settings.values()].flatMap(item => item.subscriptions));
  }
  private async update(guildId: string, change: (item: GuildSettings) => void): Promise<void> {
    const value = await this.store.update(this.path(guildId), parseSettings, current => {
      const item = current ?? { schemaVersion: 1, guildId, healthMaintainerRoleId: null, subscriptions: [] };
      if (item.guildId !== guildId) throw new StorageError("invalid-guild-id");
      change(item);
      return item;
    });
    this.settings.set(guildId, value);
  }
  async setSubscription(subscription: Subscription, enabled: boolean): Promise<void> {
    await this.update(subscription.guildId, item => {
      const exists = item.subscriptions.some(s => s.channelId === subscription.channelId && s.category === subscription.category);
      if (enabled && !exists) item.subscriptions.push(subscription);
      if (!enabled) item.subscriptions = item.subscriptions.filter(s => s.channelId !== subscription.channelId || s.category !== subscription.category);
    });
  }
  async setHealthMaintainerRole(guildId: string, roleId: string | null): Promise<void> {
    await this.update(guildId, item => { item.healthMaintainerRoleId = roleId; });
  }
}
