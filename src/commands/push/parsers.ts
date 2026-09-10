import { NotificationCategory } from "../../notifications/types";

export function parsePushRequest(args: readonly string[]): { category: NotificationCategory; enabled: boolean } | undefined {
  const category = args[0]?.toLowerCase();
  if (!["skd", "ad", "notice"].includes(category) || args.length > 2
    || (args[1] !== undefined && args[1].toLowerCase() !== "off")) return undefined;
  return { category: category as NotificationCategory, enabled: args.length === 1 };
}
