export interface ParsedCommandInput {
  name: string;
  args: readonly string[];
}

export interface CommandAttachment {
  data: Uint8Array;
  filename: string;
}

export interface SentCommandMessage {
  edit(content: string): Promise<void>;
  react(emoji: string): Promise<void>;
  clearReactions(): Promise<void>;
  waitForUserReaction(
    emojis: readonly string[],
    userId: string,
    timeoutMs: number,
  ): Promise<string | undefined>;
}

export interface InteractiveCommandOutput {
  userId: string;
  send(content: string): Promise<SentCommandMessage>;
  sendAttachment(attachment: CommandAttachment): Promise<SentCommandMessage>;
}

export interface CommandContext {
  inGuild: boolean;
  guildId?: string;
  channelId?: string;
  userId?: string;
  reply(content: string): Promise<void>;
  interactive?: InteractiveCommandOutput;
}

export interface CommandDefinition {
  name: string;
  aliases?: readonly string[];
  description?: string;
  guildOnly: boolean;
  execute(context: CommandContext, args: readonly string[]): Promise<void>;
}

export interface CommandRegistry {
  resolve(name: string): CommandDefinition | undefined;
}
