import dotenv from "dotenv";

export interface AppConfig {
  discordToken: string;
  commandPrefix: "o.";
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  dotenv.config();

  const discordToken = environment.DISCORD_TOKEN?.trim();
  if (!discordToken) {
    throw new Error("DISCORD_TOKEN is required.");
  }

  return {
    discordToken,
    commandPrefix: "o.",
  };
}
