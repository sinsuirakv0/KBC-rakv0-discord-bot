import { GachaJson } from "../../commands/gatya/types";
import { SaleJson } from "../../commands/sale/types";
import { ItemJson } from "../../commands/item/types";

const key = (value: unknown) => JSON.stringify(value);

export function addedGachas(before: GachaJson, after: GachaJson): GachaJson {
  const identify = (block: GachaJson["data"][number], entry: GachaJson["data"][number]["gachas"][number]) => {
    const { gachaCount, ...header } = block.header;
    return key({ header, entry });
  };
  const known = new Set(before.data.flatMap(block => block.gachas.map(entry => identify(block, entry))));
  return { ...after, data: after.data.map(block => ({ ...block, gachas: block.gachas.filter(entry => !known.has(identify(block, entry))) })).filter(block => block.gachas.length) };
}

export function addedSales(before: SaleJson, after: SaleJson): SaleJson {
  const identify = (entry: SaleJson["data"][number], id: number) => key({ header: entry.header, timeBlocks: entry.timeBlocks, id });
  const known = new Set(before.data.flatMap(entry => entry.stageIds.map(id => identify(entry, id))));
  return { ...after, data: after.data.map(entry => ({ ...entry, stageIds: entry.stageIds.filter(id => !known.has(identify(entry, id))) })).filter(entry => entry.stageIds.length) };
}

export function addedItems(before: ItemJson, after: ItemJson): ItemJson {
  const identify = ({ raw, ...entry }: ItemJson["data"][number]) => key(entry);
  const known = new Set(before.data.map(identify));
  return { ...after, data: after.data.filter(entry => !known.has(identify(entry))) };
}
