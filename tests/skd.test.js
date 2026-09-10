const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { addedGachas, addedSales, addedItems } = require("../dist/notifications/skd/diff");
const { formatAddedSchedules } = require("../dist/notifications/skd/formatters");
const { createScheduleDetailsBuilder } = require("../dist/notifications/skd/data-source");
const { parseDetectionEvent } = require("../dist/notifications/parsers");
const header = { startDate: "20260911", startTime: "1100", endDate: "20260918", endTime: "1100", minVersion: "150600", maxVersion: "999999" };
const document = data => ({ updatedAt: "", data });

test("schedule additions exclude existing entries and raw-only changes", () => {
  const old = { header: { ...header, gachaType: 1, gachaCount: 1 }, gachas: [{ id: 1 }] };
  const next = { ...old, header: { ...old.header, gachaCount: 2 }, gachas: [{ id: 1 }, { id: 2 }] };
  assert.deepEqual(addedGachas(document([old]), document([next])).data[0].gachas, [{ id: 2 }]);
  const sale = { header, timeBlocks: [], stageIds: [100], raw: "old" };
  assert.deepEqual(addedSales(document([sale]), document([{ ...sale, stageIds: [100, 101, 8001] }])).data[0].stageIds, [101, 8001]);
  const item = { header, gift: { eventId: 1 }, timeBlocks: [], raw: "a" };
  assert.equal(addedItems(document([item]), document([{ ...item, raw: "b" }])).data.length, 0);
});

test("four separate code blocks each show at most five rows, then the KBC link", () => {
  const ids = Array.from({ length: 7 }, (_, n) => n + 1);
  const maps = { R: new Map(ids.map(id => [id, 10])), E: new Map(), N: new Map() };
  const names = { R: new Map([[10, "ガチャ"]]), E: new Map(), N: new Map() };
  const parts = formatAddedSchedules({
    gatya: { gacha: document([{ header: { ...header, gachaType: 1 }, gachas: ids.map(id => ({ id, flags: 4, guaranteed: true })) }]), seriesMappings: maps, shortSeriesNames: names },
    sale: { sale: document([{ header, timeBlocks: [], stageIds: ids.flatMap(id => [100 + id, 8000 + id]) }]), saleNames: new Map(), allDayEventNames: new Map(), missionNames: new Map([[8001, "ミッション,説明"]]), cardSettingStageIds: [] },
    item: { item: document(ids.map(id => ({ header, gift: { giftType: id, giftAmount: 1, title: "アイテム```" } }))), itemNames: new Map(), saleNames: new Map() },
  }, new Date("2026-09-10T00:00:00Z"), "https://example.com/history");
  assert.deepEqual(parts.map(p => p.split("\n")[0]), ["**gatya**", "**sale**", "**item**", "**mission**", "**KBC**"]);
  for (const content of parts.slice(0, 4)) {
    assert.equal((content.match(/^    /gm) || []).length, 5);
    assert.equal((content.match(/```/g) || []).length, 2);
    assert.match(content, /その他2件/);
    assert.ok(content.length <= 2000);
  }
  assert.doesNotMatch(parts[1], /8001/);
  assert.match(parts[3], /8001 ミッション/);
  assert.match(parts[4], /https:\/\/example.com\/history/);
});

test("ready notifications parse pinned TSV through event parsers and reject hash or path mismatches", async () => {
  const tsv = "[start]\n20260911\t1100\t20260918\t1100\t150600\t999999\t0\t0\t2\t100\t8001\n[end]";
  const event = { version: 1, eventId: "skd:test", category: "skd", phase: "ready", detectedAt: "2026-09-10T00:00:00Z", types: ["sale"],
    source: { beforeRef: "a".repeat(40), afterRef: "b".repeat(40), files: { sale: { path: "raw/sale_123.tsv", hash: createHash("md5").update(tsv).digest("hex") } } } };
  const urls = [];
  const builder = createScheduleDetailsBuilder({
    fetch: async url => { urls.push(url); return new Response(url.includes("/data/") ? JSON.stringify(document([])) : tsv); },
    gatya: { fetchScheduleData: async () => assert.fail("unchanged gatya") },
    item: { fetchDisplayData: async () => assert.fail("unchanged item") },
    sale: { fetchDisplayData: async sale => ({ sale, saleNames: new Map([[100, "ステージ"]]), missionNames: new Map([[8001, "任務"]]), allDayEventNames: new Map(), cardSettingStageIds: [] }) },
  });
  const result = await builder(parseDetectionEvent(event));
  assert.match(result[0], /追加なし/);
  assert.match(result[1], /100 ステージ/);
  assert.match(result[3], /8001 任務/);
  assert.match(result[4], /tab=history&tsv=123&type=all/);
  assert.ok(urls[0].includes("a".repeat(40)) && urls[1].includes("b".repeat(40)));
  const invalid = structuredClone(event); invalid.source.files.sale.hash = "0".repeat(32);
  await assert.rejects(builder(parseDetectionEvent(invalid)), /hash mismatch/);
  invalid.source.files.sale.path = "https://example.com/private";
  assert.throws(() => parseDetectionEvent(invalid), /Invalid schedule source/);
});
