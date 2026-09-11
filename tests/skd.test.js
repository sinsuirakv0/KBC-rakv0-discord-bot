const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { compareGachas, compareSales, compareItems } = require("../dist/notifications/skd/diff");
const { formatAddedSchedules } = require("../dist/notifications/skd/formatters");
const { createScheduleDetailsBuilder } = require("../dist/notifications/skd/data-source");
const { parseDetectionEvent } = require("../dist/notifications/parsers");
const header = { startDate: "20260911", startTime: "1100", endDate: "20260918", endTime: "1100", minVersion: "150600", maxVersion: "999999" };
const document = data => ({ updatedAt: "", data });

test("schedule additions exclude existing entries and raw-only changes", () => {
  const old = { header: { ...header, gachaType: 1, gachaCount: 1 }, gachas: [{ id: 1 }] };
  const next = { ...old, header: { ...old.header, gachaCount: 2 }, gachas: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(compareGachas(document([old]), document([next])).added.data[0].gachas, [{ id: 2 }]);
  const sale = { header, timeBlocks: [], stageIds: [100], raw: "old" };
  assert.deepEqual(compareSales(document([sale]), document([{ ...sale, stageIds: [100, 101, 8001] }])).added.data.flatMap(entry => entry.stageIds), [101, 8001]);
  const item = { header, gift: { eventId: 1 }, timeBlocks: [], raw: "a" };
  assert.equal(compareItems(document([item]), document([{ ...item, raw: "b" }])).added.data.length, 0);
});

test("date and version replacements are combined as five changes while retained schedules stay additions", () => {
  const nextHeader = { ...header, startDate: "20260912", minVersion: "150700" };
  const oldGacha = { header: { ...header, gachaType: 1, gachaCount: 1 }, gachas: [{ id: 1, flags: 0 }] };
  const nextGacha = { ...oldGacha, header: { ...nextHeader, gachaType: 1, gachaCount: 1 } };
  const gatya = compareGachas(document([oldGacha]), document([nextGacha]));
  assert.equal(gatya.added.data.length, 0);
  assert.equal(gatya.changes.length, 1);
  const retained = compareGachas(document([oldGacha]), document([oldGacha, nextGacha]));
  assert.equal(retained.added.data.length, 1);
  assert.equal(retained.changes.length, 0);
  const oldSale = { header, timeBlocks: [], stageIds: [100, 8001, 8002, 8003] };
  const sale = compareSales(document([oldSale]), document([{ ...oldSale, header: nextHeader, stageIds: [...oldSale.stageIds, 101] }]));
  assert.deepEqual(sale.added.data.flatMap(entry => entry.stageIds), [101]);
  assert.equal(sale.changes.length, 4);
  const oldItem = { header, timeBlocks: [], gift: { eventId: 1, giftType: 2, giftAmount: 1, title: "アイテム" } };
  const item = compareItems(document([oldItem]), document([{ ...oldItem, header: nextHeader }]));
  assert.equal(item.added.data.length, 0);
  assert.equal(item.changes.length, 1);
  const now = new Date("2026-09-10T00:00:00Z");
  const parts = formatAddedSchedules({
    gatya: { gacha: gatya.added, seriesMappings: { R: new Map([[1, 10]]), E: new Map(), N: new Map() }, shortSeriesNames: { R: new Map([[10, "ガチャ"]]), E: new Map(), N: new Map() } },
    sale: { sale: sale.added, saleNames: new Map(), allDayEventNames: new Map(), missionNames: new Map(), cardSettingStageIds: [] },
    item: { item: item.added, itemNames: new Map(), saleNames: new Map() },
    changes: { gatya: gatya.changes, sale: sale.changes, item: item.changes },
  }, now, "https://example.com/history");
  assert.deepEqual(parts.map(part => part.split("\n")[0]), ["**sale**", "**変更**", "**KBC**"]);
  assert.equal((parts[1].match(/^\[(gatya|sale|item|mission)\]/gm) || []).length, 5);
  for (const type of ["gatya", "sale", "item", "mission"]) assert.ok(parts[1].includes(`[${type}]`));
  assert.match(parts[1], /2026\/09\/11 11:00 → 2026\/09\/12 11:00/);
  assert.match(parts[1], /必要Ver: 150600 → 150700/);
  assert.match(parts[1], /その他1件/);
  assert.ok(parts.every(part => part.length <= 2000));
  assert.deepEqual(formatAddedSchedules({}, now, "https://example.com/history"), ["**KBC**\n<https://example.com/history>"]);
});

test("four separate code blocks each show at most five rows, then the KBC link", () => {
  const ids = Array.from({ length: 7 }, (_, n) => n + 1);
  const maps = { R: new Map(ids.map(id => [id, 10])), E: new Map(), N: new Map() };
  const names = { R: new Map([[10, "ガチャ"]]), E: new Map(), N: new Map() };
  const parts = formatAddedSchedules({
    gatya: { gacha: document([{ header: { ...header, gachaType: 1 }, gachas: ids.map(id => ({ id, flags: 4, guaranteed: true })) }]), seriesMappings: maps, shortSeriesNames: names },
    sale: { sale: document([{ header, timeBlocks: [], stageIds: ids.flatMap(id => [100 + id, 8000 + id]) }]), saleNames: new Map(), allDayEventNames: new Map(), missionNames: new Map([[8001, "ミッション<br>説明\r\n進行状況,別項目"]]), cardSettingStageIds: [] },
    item: { item: document(ids.map(id => ({ header, gift: { giftType: id, giftAmount: 1, title: "アイテム```" } }))), itemNames: new Map(), saleNames: new Map() },
  }, new Date("2026-09-10T00:00:00Z"), "https://example.com/history");
  assert.deepEqual(parts.map(p => p.split("\n")[0]), ["**gatya**", "**sale**", "**item**", "**mission**", "**KBC**"]);
  for (const content of parts.slice(0, 4)) {
    assert.doesNotMatch(content, /🟠/);
    assert.equal((content.match(/^    \d+ /gm) || []).length, 5);
    assert.equal((content.match(/```/g) || []).length, 2);
    assert.match(content, /その他2件/);
    assert.ok(content.length <= 2000);
  }
  assert.doesNotMatch(parts[1], /8001/);
  assert.match(parts[3], /8001 ミッション\n    説明\n    進行状況 <7d>/);
  assert.doesNotMatch(parts[3], /<br>|別項目/);
  assert.match(parts[4], /https:\/\/example.com\/history/);
});

test("permanent additions and changes remain visible, including the April 1 popup", () => {
  const permanent = { ...header, startDate: "20260401", startTime: "1500", endDate: "20300101", endTime: "000", minVersion: "150300" };
  const sale = { header: permanent, timeBlocks: [], stageIds: [114, 8001] };
  const expired = { ...sale, header: { ...permanent, endDate: "20260331" }, stageIds: [115] };
  const change = { ...sale, stageIds: [116] };
  const parts = formatAddedSchedules({
    gatya: { gacha: document([{ header: { ...permanent, gachaType: 1 }, gachas: [{ id: 1, flags: 0 }] }]),
      seriesMappings: { R: new Map(), E: new Map(), N: new Map() }, shortSeriesNames: { R: new Map(), E: new Map(), N: new Map() } },
    sale: { sale: document([sale, expired]), saleNames: new Map([[114, "新バージョン告知ポップアップ"]]), allDayEventNames: new Map(), missionNames: new Map([[8001, "常設ミッション"]]), cardSettingStageIds: [] },
    item: { item: document([{ header: permanent, gift: { giftType: 2, giftAmount: 1, title: "アイテム" } }]), itemNames: new Map(), saleNames: new Map() },
    changes: { sale: [{ before: { ...change, header: { ...permanent, endDate: "20260402" } }, after: change }] },
  }, new Date("2026-04-01T06:07:12Z"), "https://example.com/history");
  assert.deepEqual(parts.map(part => part.split("\n")[0]), ["**gatya**", "**sale**", "**item**", "**mission**", "**変更**", "**KBC**"]);
  for (const part of parts.slice(0, 4)) {
    assert.match(part, /🟢 \[4\/1\(水\) 15:00~\] 常設/);
    assert.doesNotMatch(part, /2030|<\d+d/);
  }
  assert.match(parts[1], /114 新バージョン告知ポップアップ/);
  assert.doesNotMatch(parts[1], /115 /);
  assert.match(parts[4], /終了: 2026\/04\/02 00:00 → 常設/);
  assert.ok(parts.every(part => part.length <= 2000));
});

test("ready notifications compare the latest previous raw TSV and reject incomplete history or mismatches", async () => {
  const before = "[start]\n20260911\t1100\t20260918\t1100\t150600\t999999\t0\t0\t1\t100\n[end]";
  const tsv = "[start]\n20260911\t1100\t20260918\t1100\t150600\t999999\t0\t0\t3\t100\t101\t8001\n[end]";
  const event = { version: 1, eventId: "skd:test", category: "skd", phase: "ready", detectedAt: "2026-09-10T00:00:00Z", types: ["sale"],
    source: { beforeRef: "a".repeat(40), afterRef: "b".repeat(40), files: { sale: { path: "raw/sale_123.tsv", hash: createHash("md5").update(tsv).digest("hex") } } } };
  const urls = [];
  const tree = { truncated: false, tree: [
    { type: "blob", path: "raw/sale_122.tsv" }, { type: "blob", path: "raw/sale_121.tsv" },
  ] };
  const builder = createScheduleDetailsBuilder({
    fetch: async url => {
      urls.push(url);
      if (url.includes("/git/trees/")) return new Response(JSON.stringify(tree));
      if (url.endsWith("a".repeat(40) + "/raw/sale_122.tsv")) return new Response(before);
      assert.ok(url.endsWith("b".repeat(40) + "/raw/sale_123.tsv"));
      return new Response(tsv);
    },
    gatya: { fetchScheduleData: async () => assert.fail("unchanged gatya") },
    item: { fetchDisplayData: async () => assert.fail("unchanged item") },
    sale: { fetchDisplayData: async sale => ({ sale, saleNames: new Map([[101, "ステージ"]]), missionNames: new Map([[8001, "任務"]]), allDayEventNames: new Map(), cardSettingStageIds: [] }) },
  });
  const result = await builder(parseDetectionEvent(event));
  assert.deepEqual(result.map(part => part.split("\n")[0]), ["**sale**", "**mission**", "**KBC**"]);
  assert.match(result[0], /101 ステージ/);
  assert.doesNotMatch(result[0], /100 /);
  assert.match(result[1], /8001 任務/);
  assert.match(result[2], /tab=history&tsv=123&type=all/);
  assert.ok(urls[0].includes("a".repeat(40)) && urls[1].includes("a".repeat(40)) && urls[2].includes("b".repeat(40)));
  const invalid = structuredClone(event); invalid.source.files.sale.hash = "0".repeat(32);
  await assert.rejects(builder(parseDetectionEvent(invalid)), /hash mismatch/);
  invalid.source.files.sale.path = "https://example.com/private";
  assert.throws(() => parseDetectionEvent(invalid), /Invalid schedule source/);
  tree.truncated = true;
  await assert.rejects(builder(parseDetectionEvent(event)), /Invalid schedule history tree/);
  tree.truncated = false; tree.tree = [];
  await assert.rejects(builder(parseDetectionEvent(event)), /Previous sale TSV unavailable/);
});


test("skd selects 100-second updates and accepts latest, slash dates and spaced dates", async () => {
  const { parseSkdDate } = require("../dist/commands/skd/parsers");
  const { selectScheduleUpdate } = require("../dist/commands/skd/domain");
  const { createSkdDataSource } = require("../dist/commands/skd/data-source");
  const { createSkdCommand } = require("../dist/commands/skd/command");
  const base = Date.parse("2026-07-30T02:00:00Z") / 1000;
  const file = (type, timestamp) => ({ type, timestamp, path: "raw/" + type + "_" + timestamp + ".tsv" });
  const batch = [file("gatya", base), file("sale", base + 100)];
  assert.equal(selectScheduleUpdate(batch).files.length, 2);
  assert.equal(selectScheduleUpdate([...batch, file("item", base + 101)]).timestamp, base + 101);
  assert.equal(parseSkdDate(["2026/7/30"]), "2026-07-30");
  assert.equal(parseSkdDate(["2026", "07", "30"]), "2026-07-30");
  const files = [file("item", base + 2 * 86400), file("gatya", base - 86400), file("sale", base - 86400 + 1), ...batch, file("gatya", base + 10)];
  const calls = [];
  const dataSource = createSkdDataSource({
    readHistorySnapshot: async () => ({ ref: "a".repeat(40), files }),
    buildDetails: async (comparisons, detectedAt) => { calls.push({ comparisons, detectedAt }); return ["schedule list", "KBC link"]; },
  });
  const command = createSkdCommand(dataSource);
  const replies = [];
  const context = { inGuild: true, reply: async text => replies.push(text) };
  await command.execute(context, []);
  assert.deepEqual(calls[0].comparisons.map(pair => pair.type), ["item"]);
  await command.execute(context, ["2026/07/31"]);
  assert.deepEqual(calls[1].comparisons.map(pair => pair.type), ["gatya", "sale"]);
  assert.equal(calls[1].comparisons[0].before.path, file("gatya", base - 86400).path);
  assert.equal(calls[1].comparisons[0].after.path, file("gatya", base + 10).path);
  assert.ok(replies[3].startsWith("**スケジュール更新**"));
  assert.ok(replies[3].includes("2026/07/30"));
  assert.deepEqual(replies.slice(4, 6), ["schedule list", "KBC link"]);
  await command.execute(context, ["2026", "07", "30"]);
  assert.deepEqual(calls[2], calls[1]);
  await command.execute(context, ["2026/02/30"]);
  assert.equal(calls.length, 3);
  assert.ok(replies.at(-1).includes("使い方"));
});
