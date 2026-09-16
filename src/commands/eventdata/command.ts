import { CommandContext, CommandDefinition, InteractiveCommandOutput } from "../types";
import { remoteEventDataSource } from "./data-source";
import { buildKbcEventDataUrl } from "./domain";
import { parseEventDataRequest } from "./parsers";
import { EventDataDataSource, EventDataType } from "./types";

const DEFAULT_LINK_TYPES: readonly EventDataType[] = ["gatya", "sale", "item"];
const ALL_LINK_TYPES: readonly EventDataType[] = [
  "gatya",
  "sale",
  "item",
  "notice",
  "ad",
];
const INVALID_MESSAGE =
  "❌ 指定が正しくありません。o.eventdata help で使い方を確認してください。";
const DATA_ERROR_MESSAGE =
  "❌ eventdataの取得に失敗しました。時間をおいて再度お試しください。";

export interface EventDataCommandDependencies {
  dataSource: EventDataDataSource;
}

function formatLinks(
  types: readonly EventDataType[],
  links: ReadonlyMap<EventDataType, string>,
): string {
  return types.map((type) => `[${type}]\n${links.get(type)}`).join("\n\n");
}

async function sendFailure(output: InteractiveCommandOutput, error: unknown): Promise<void> {
  console.error("Event data retrieval failed.", error);
  await output.send(DATA_ERROR_MESSAGE);
}

export function createEventDataCommand(
  dependencies: EventDataCommandDependencies,
): CommandDefinition {
  return {
    name: "eventdata",
    guildOnly: true,
    async execute(context: CommandContext, args: readonly string[]): Promise<void> {
      const output = context.interactive;
      if (!output) {
        await context.reply(DATA_ERROR_MESSAGE);
        return;
      }
      const request = parseEventDataRequest(args);
      if (request.kind === "invalid") {
        await output.send(INVALID_MESSAGE);
        return;
      }
      try {
        if (request.kind === "all-links") {
          const links = await dependencies.dataSource.fetchOfficialLinks(DEFAULT_LINK_TYPES, "jp");
          await output.send(formatLinks(DEFAULT_LINK_TYPES, links));
          return;
        }
        if (request.kind === "all") {
          if (request.file) {
            const attachments = await Promise.all(
              ALL_LINK_TYPES.map((type) =>
                dependencies.dataSource.fetchAttachment({
                  kind: "selected",
                  type,
                  country: request.country,
                  file: true,
                  encrypted: request.encrypted,
                  kbc: request.kbc,
                }),
              ),
            );
            for (const attachment of attachments) {
              await output.sendAttachment(attachment);
            }
            return;
          }
          const links = request.kbc
            ? new Map(
                ALL_LINK_TYPES.map((type) => [
                  type,
                  buildKbcEventDataUrl(type, request.country, request.encrypted),
                ]),
              )
            : await dependencies.dataSource.fetchOfficialLinks(
                ALL_LINK_TYPES,
                request.country,
              );
          await output.send(formatLinks(ALL_LINK_TYPES, links));
          return;
        }
        if (request.file) {
          await output.sendAttachment(await dependencies.dataSource.fetchAttachment(request));
          return;
        }
        if (request.kbc) {
          await output.send(
            formatLinks(
              [request.type],
              new Map([
                [
                  request.type,
                  buildKbcEventDataUrl(
                    request.type,
                    request.country,
                    request.encrypted,
                  ),
                ],
              ]),
            ),
          );
          return;
        }
        const links = await dependencies.dataSource.fetchOfficialLinks(
          [request.type],
          request.country,
        );
        await output.send(formatLinks([request.type], links));
      } catch (error) {
        await sendFailure(output, error);
      }
    },
  };
}

export const eventDataCommand = createEventDataCommand({
  dataSource: remoteEventDataSource,
});
