import { GachaBlock, GachaJson } from "../../commands/gatya/types";
import { SaleEntry, SaleHeader, SaleJson } from "../../commands/sale/types";
import { ItemEntry, ItemJson } from "../../commands/item/types";

const key = (value: unknown) => JSON.stringify(value);
const headerFields = ["startDate", "startTime", "endDate", "endTime", "minVersion", "maxVersion"] as const;

export interface ScheduleChange<T> { before: T; after: T; }
export interface ScheduleChanges {
  gatya?: ScheduleChange<GachaBlock>[];
  sale?: ScheduleChange<SaleEntry>[];
  item?: ScheduleChange<ItemEntry>[];
}

function compareEntries<T extends { header: SaleHeader }>(before: T[], after: T[], identify: (entry: T) => unknown) {
  const previous = new Set(before.map(key));
  const current = new Set(after.map(key));
  const removed = before.filter(entry => !current.has(key(entry)));
  const added: T[] = [];
  const changes: ScheduleChange<T>[] = [];
  for (const entry of after.filter(entry => !previous.has(key(entry)))) {
    let match = -1;
    let difference = Infinity;
    for (const [index, candidate] of removed.entries()) {
      if (key(identify(candidate)) !== key(identify(entry))) continue;
      const score = headerFields.filter(field => candidate.header[field] !== entry.header[field]).length;
      if (score < difference) { match = index; difference = score; }
    }
    if (match === -1) added.push(entry);
    else changes.push({ before: removed.splice(match, 1)[0], after: entry });
  }
  return { added, changes };
}

export function compareGachas(before: GachaJson, after: GachaJson) {
  const entries = (json: GachaJson): GachaBlock[] => json.data.flatMap(block => block.gachas.map(entry => ({
    header: { ...block.header, gachaCount: 1 }, gachas: [entry],
  })));
  const result = compareEntries(entries(before), entries(after), block => ({ type: block.header.gachaType, gachas: block.gachas }));
  return { added: { ...after, data: result.added }, changes: result.changes };
}

export function compareSales(before: SaleJson, after: SaleJson) {
  const entries = (json: SaleJson): SaleEntry[] => json.data.flatMap(entry => entry.stageIds.map(id => ({
    header: entry.header, timeBlocks: entry.timeBlocks, stageIds: [id],
  })));
  const result = compareEntries(entries(before), entries(after), entry => ({ timeBlocks: entry.timeBlocks, stageIds: entry.stageIds }));
  const added = new Set(result.added.map(entry => key([entry.header, entry.timeBlocks, entry.stageIds[0]])));
  const data = after.data.map(entry => ({ ...entry, stageIds: entry.stageIds.filter(id => added.has(key([entry.header, entry.timeBlocks, id]))) }))
    .filter(entry => entry.stageIds.length);
  return { added: { ...after, data }, changes: result.changes };
}

export function compareItems(before: ItemJson, after: ItemJson) {
  const entries = (json: ItemJson) => json.data.map(({ raw, ...entry }) => entry);
  const result = compareEntries(entries(before), entries(after), entry => ({ gift: entry.gift, timeBlocks: entry.timeBlocks }));
  return { added: { ...after, data: result.added }, changes: result.changes };
}
