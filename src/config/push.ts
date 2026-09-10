

export const eventBodyLimitBytes = 16 * 1024;
export const eventRequestTimeoutMs = 15_000;

export function loadPushConfig(environment: NodeJS.ProcessEnv = process.env) {
  const port = Number(environment.EVENT_UPDATE_PORT || environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid EVENT_UPDATE_PORT");
  return {
    port,
    host: environment.EVENT_UPDATE_HOST || "0.0.0.0",
    secret: environment.EVENT_UPDATE_SECRET?.trim() || "",
  };
}
