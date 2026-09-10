const assert = require("node:assert/strict");
const test = require("node:test");

const { createGatyaCommand } = require("../dist/commands/gatya/command");
const { createRemoteGatyaDataSource } = require("../dist/commands/gatya/data-source");
const { parseGatyaRequest } = require("../dist/commands/gatya/domain");
const {
  formatGachaDetail,
  formatSchedule,
  formatSeriesSummaries,
} = require("../dist/commands/gatya/formatters");
const { parseSeriesMappingTsv } = require("../dist/commands/gatya/parsers");

function createBlock({
  startDate = "20260105",
  startTime = "1000",
  endDate = "20260110",
  endTime = "1000",
  gachaType = 1,
  id = 101,
  raw = "raw\t101",
} = {}) {
  return {
    header: {
      startDate,
      startTime,
      endDate,
      endTime,
      minVersion: "150000",
      maxVersion: "999999",
      gachaType,
      gachaCount: 1,
    },
    gachas: [{
      id,
      price: 150,
      flags: 4,
      rates: {
        normal: 250,
        rare: 6250,
        superRare: 2300,
        uberRare: 1000,
        legendRare: 200,
      },
      guaranteed: true,
      message: "テストメッセージ",
    }],
    raw,
  };
}

function createItemEntry({
  startDate = "20260105",
  startTime = "1000",
  endDate = "20260110",
  endTime = "1000",
  giftType = 301,
} = {}) {
  return {
    header: { startDate, startTime, endDate, endTime },
    gift: { giftType },
  };
}

function createMaps(rEntries = []) {
  return { R: new Map(rEntries), E: new Map(), N: new Map() };
}

function createLookupData(blocks) {
  return {
    gacha: { updatedAt: "test", data: blocks },
    gachaNames: createMaps([[101, "個別ガチャ"], [102, "個別ガチャ2"]]),
    seriesNames: createMaps([[7, "正式シリーズ名"]]),
    shortSeriesNames: createMaps([[7, "短縮シリーズ名"]]),
    seriesMappings: createMaps([[101, 7], [102, 7]]),
  };
}

function createFakeOutput() {
  const messages = [];
  return {
    userId: "user-1",
    messages,
    async send(content) {
      const message = {
        content,
        deleted: false,
        async edit(nextContent) { this.content = nextContent; },
        async delete() { this.deleted = true; },
        async react() {},
        async waitForUserReaction() { return undefined; },
      };
      messages.push(message);
      return message;
    },
  };
}

test("gatya request parser supports mode, gatyaID, seriesID, JSON, and Raw", () => {
  assert.deepEqual(parseGatyaRequest([]), { kind: "schedule", mode: null });
  assert.deepEqual(parseGatyaRequest(["E", "12"]), {
    kind: "detail", mode: "E", target: { kind: "gacha", id: 12 },
  });
  assert.deepEqual(parseGatyaRequest(["R", "s7", "json"]), {
    kind: "json", mode: "R", target: { kind: "series", id: 7 },
  });
  assert.deepEqual(parseGatyaRequest(["s7", "RAW"]), {
    kind: "raw", mode: null, target: { kind: "series", id: 7 },
  });
  assert.deepEqual(parseGatyaRequest(["夏", "限定"]), {
    kind: "search", mode: null, query: "夏 限定",
  });

  const mapping = parseSeriesMappingTsv(
    "GatyaSetID\tunused\tseriesID\n101\t0\t7\n102\t0\t7\n",
  );
  assert.deepEqual([...mapping], [[101, 7], [102, 7]]);
});

test("schedule uses sale date grouping and aggregates gatyaIDs by series", () => {
  const blocks = [
    createBlock(),
    createBlock({ startDate: "20260106", startTime: "1100", endTime: "1200", id: 102 }),
    createBlock({
      startDate: "20260120", startTime: "1000", endDate: "20260122", id: 101,
    }),
    createBlock({
      startDate: "20260120", startTime: "1100", endDate: "20260123", id: 102,
    }),
  ];
  const data = {
    gacha: { updatedAt: "test", data: blocks },
    item: {
      updatedAt: "test",
      data: [
        createItemEntry(),
        createItemEntry({
          startDate: "20260120",
          endDate: "20300101",
          endTime: "0000",
          giftType: 302,
        }),
      ],
    },
    saleNames: new Map([
      [301, "ガチャ半額リセット（単発）"],
      [302, "ガチャ半額リセット（11連）"],
    ]),
    shortSeriesNames: createMaps([[7, "短縮シリーズ名"]]),
    seriesMappings: createMaps([[101, 7], [102, 7]]),
  };
  const output = formatSchedule(data, new Date("2026-01-07T00:00:00.000Z"), null);

  assert.equal((output.match(/🟢 \[~1\/10\(土\) 10:00\]/g) ?? []).length, 1);
  assert.equal((output.match(/🟠 \[1\/20\(火\) 10:00~\]/g) ?? []).length, 1);
  assert.equal((output.match(/101 s7 短縮シリーズ名【確定】【step up】/g) ?? []).length, 2);
  assert.equal((output.match(/102 s7 短縮シリーズ名【確定】【step up】/g) ?? []).length, 2);
  assert.match(output, /301 ガチャ半額リセット（単発）/);
  assert.match(output, /302 ガチャ半額リセット（11連）/);
  assert.ok(output.indexOf("301 ガチャ半額") < output.indexOf("101 s7"));
  assert.match(
    formatSchedule(data, new Date("2026-01-07T00:00:00.000Z"), "R"),
    /301 ガチャ半額リセット（単発）/,
  );
  assert.equal(formatSchedule(data, new Date("2026-01-07T00:00:00.000Z"), "E"), undefined);
  assert.equal(formatSchedule(data, new Date("2026-01-07T00:00:00.000Z"), "N"), undefined);
  assert.doesNotMatch(
    formatSchedule(data, new Date("2026-01-20T02:00:00.000Z"), null),
    /302 ガチャ半額リセット（11連）/,
  );
  assert.doesNotMatch(output, /短縮シリーズ名 【確定】|【確定】 【step up】/);
  assert.doesNotMatch(output, /\n\n🟠/);
});

test("gatya detail shows individual name, seriesID, inherited labels, and selected nonzero rates", () => {
  const block = createBlock();
  const output = formatGachaDetail(block, block.gachas[0], createLookupData([block]));

  assert.match(output, /101 s7 個別ガチャ【確定】【step up】/);
  assert.match(output, /ver\.150000～999999/);
  assert.match(output, /レート: ノーマル 250, レア 6250, 超激レア 1000, 伝説レア 200/);
  assert.doesNotMatch(output, /2300/);
  assert.match(output, /メッセージ: テストメッセージ/);

  assert.equal(
    formatSeriesSummaries([{ mode: "R", seriesId: 7, name: "正式シリーズ名", gachaIds: [101, 102] }]),
    "101 s7 正式シリーズ名\n102 s7 正式シリーズ名",
  );
});

test("series JSON and Raw return every matching block", async () => {
  const blocks = [createBlock(), createBlock({ id: 102, raw: "raw\t102" })];
  const data = createLookupData(blocks);
  const dataSource = {
    async fetchGachaJson() { return data.gacha; },
    async fetchJsonWithMappings() {
      return { gacha: data.gacha, seriesMappings: data.seriesMappings };
    },
    async fetchScheduleData() { return data; },
    async fetchLookupData() { return data; },
  };
  const command = createGatyaCommand({
    dataSource,
    now: () => new Date(0),
  });
  const context = { inGuild: true, async reply() {} };

  const jsonOutput = createFakeOutput();
  await command.execute({ ...context, interactive: jsonOutput }, ["s7", "json"]);
  assert.equal(jsonOutput.messages.length, 2);
  assert.doesNotMatch(jsonOutput.messages[0].content, /\"raw\"/);
  assert.match(jsonOutput.messages[0].content, /\"id\": 101/);
  assert.match(jsonOutput.messages[1].content, /\"id\": 102/);

  const rawOutput = createFakeOutput();
  await command.execute({ ...context, interactive: rawOutput }, ["s7", "raw"]);
  assert.equal(rawOutput.messages.length, 2);
  assert.match(rawOutput.messages[0].content, /raw {4}101/);
  assert.match(rawOutput.messages[1].content, /raw {4}102/);
});

test("missing optional series-name files fall back to published gacha names", async () => {
  const block = createBlock();
  const urls = {
    gachaJson: "https://example.test/gatya.json",
    itemJson: "https://example.test/item.json",
    saleNames: "https://example.test/sale-names.csv",
    gachaNames: {
      R: "https://example.test/gatya-r.csv",
      E: "https://example.test/gatya-e.csv",
      N: "https://example.test/gatya-n.csv",
    },
    seriesNames: {
      R: "https://example.test/series-r.csv",
      E: "https://example.test/series-e.csv",
      N: "https://example.test/series-n.csv",
    },
    shortSeriesNames: {
      R: "https://example.test/short-r.csv",
      E: "https://example.test/short-e.csv",
      N: "https://example.test/short-n.csv",
    },
    seriesMappings: {
      R: "https://example.test/mapping-r.tsv",
      E: "https://example.test/mapping-e.tsv",
      N: "https://example.test/mapping-n.tsv",
    },
  };
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith("gatya.json")) {
      return new Response(JSON.stringify({ updatedAt: "test", data: [block] }));
    }
    if (value.endsWith("item.json")) {
      return new Response(JSON.stringify({ updatedAt: "test", data: [] }));
    }
    if (value.endsWith("sale-names.csv")) return new Response("301,半額リセット\n");
    if (value.includes("series-") || value.includes("short-")) {
      return new Response("not found", { status: 404 });
    }
    if (value.endsWith("gatya-r.csv")) return new Response("101,公開中の個別名\n");
    if (value.includes("gatya-")) return new Response("");
    if (value.endsWith("mapping-r.tsv")) {
      return new Response("GatyaSetID\tseriesID\n101\t7\n");
    }
    return new Response("GatyaSetID\tseriesID\n");
  };
  const dataSource = createRemoteGatyaDataSource({ urls, fetchImpl });

  const scheduleData = await dataSource.fetchScheduleData();
  const lookupData = await dataSource.fetchLookupData();

  assert.equal(scheduleData.shortSeriesNames.R.get(7), "公開中の個別名");
  assert.equal(lookupData.shortSeriesNames.R.get(7), "公開中の個別名");
  assert.equal(lookupData.seriesNames.R.size, 0);
});
