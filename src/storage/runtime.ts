import { loadStorageConfig, storageLimits } from "../config/storage";
import { NotificationStore } from "../notifications/store";
import { GitHubDataRepository } from "./github-repository";
import { JsonStore } from "./json-store";
import { GuildSettingsStore } from "./guild-settings";
import { StorageError } from "./types";

let runtime: { json: JsonStore; guilds: GuildSettingsStore; notifications: NotificationStore } | undefined;
let ready = false;
function getRuntime() {
  if (!runtime) {
    const config = loadStorageConfig();
    if (!config) throw new StorageError("not-configured");
    const json = new JsonStore(new GitHubDataRepository(config));
    const guilds = new GuildSettingsStore(json);
    runtime = { json, guilds, notifications: new NotificationStore(json, guilds) };
  }
  return runtime;
}
export function isStorageReady(): boolean { return ready; }
export function getNotificationStore(): NotificationStore {
  if (!ready) throw new StorageError("not-ready");
  return getRuntime().notifications;
}
export async function initializeStorage(createManifest = false): Promise<void> {
  ready = false;
  const value = getRuntime();
  await value.json.initialize(createManifest);
  await value.guilds.restore();
  ready = true;
}
export function startStorage(): void {
  const attempt = async () => {
    try { await initializeStorage(); console.log("GitHub storage ready."); }
    catch (error) {
      console.error("GitHub storage unavailable.", error instanceof StorageError ? error.code : "configuration-error");
      setTimeout(attempt, Math.max(storageLimits.retryDelayMs, error instanceof StorageError ? error.retryAfterMs : 0)).unref();
    }
  };
  void attempt();
}
