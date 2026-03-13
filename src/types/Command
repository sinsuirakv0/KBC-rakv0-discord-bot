import { Message } from "discord.js";

export interface Command {
  /** コマンド名（例: "ping" → "k.ping" で呼び出し） */
  name: string;
  /** コマンドの説明 */
  description: string;
  /** 使い方（省略可） */
  usage?: string;
  /** コマンドの実行処理 */
  execute(message: Message, args: string[]): Promise<void>;
}
