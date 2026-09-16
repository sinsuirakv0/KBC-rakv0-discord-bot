import { CommandAttachment } from "../types";

export type EventDataType = "sale" | "gatya" | "item" | "ad" | "notice";
export type EventDataCountry = "jp" | "en" | "kr" | "tw";

export type EventDataRequest =
  | { kind: "all-links" }
  | {
      kind: "all";
      country: EventDataCountry;
      kbc: boolean;
    }
  | { kind: "invalid" }
  | {
      kind: "selected";
      type: EventDataType;
      country: EventDataCountry;
      file: boolean;
      encrypted: boolean;
      kbc: boolean;
    };

export interface EventDataFileInfo {
  plain: string;
  encrypted: string;
}

export interface EventDataDataSource {
  fetchOfficialLinks(
    types: readonly EventDataType[],
    country: EventDataCountry,
  ): Promise<ReadonlyMap<EventDataType, string>>;
  fetchAttachment(
    request: Extract<EventDataRequest, { kind: "selected" }>,
  ): Promise<CommandAttachment>;
}
