const assert = require("node:assert/strict");
const test = require("node:test");

const { createItemCommand } = require("../dist/commands/item/command");
const { parseItemRequest, searchItemEntries } = require("../dist/commands/item/domain");
const {
  formatItemDetail,
  formatItemSchedule,
} = require("../dist/commands/item/formatters");
const { parseItemJson, parseItemNameCsv } = require("../dist/commands/item/parsers");

function createEntry({
  startDate = "20260105",
  startTime = "1000",
  endDate = "20260110",
  endTime = "1000",
  eventId = 51754,
  giftType = 828,
  giftAmount = 0,
  title = "",
  message = "",
  url = "",
  repeatFlag = 4,
  timeBlocks = [],
  raw = "raw\t828",
} = {}) {
  return {
    header: {
      startDate,
      startTime,
      endDate,
      endTime,
      minVersion: "150501",
      maxVersion: "999999",
    },
    timeBlocks,
    gift: { eventId, giftType, giftAmount, title, message, url, repeatFlag },
    raw,
  };
}

function createDisplayData(entries) {
  return {
    item: { updatedAt: "test", data: entries },
    itemNames: new Map([
      [301, { name: "item側の単発名", detail: "" }],
      [302, { name: "item側の11連名", detail: "" }],
      [828, {
        name: "レアチケット販売",
        detail: "<b>・レアチケット 1枚</b><br/>・価格：160円 &amp; 税&lt;i&gt;込&lt;/i&gt;",
      }],
    ]),
    saleNames: new Map([
      [301, "ガチャ半額リセット（単発）"],
      [302, "ガチャ半額リセット（11連）"],
    ]),
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

test("item request and external data parsers validate the supported forms", () => {
  assert.deepEqual(parseItemRequest([]), { kind: "schedule" });
  assert.deepEqual(parseItemRequest(["828"]), { kind: "detail", id: 828 });
  assert.deepEqual(parseItemRequest(["828", "JSON"]), { kind: "json", id: 828 });
  assert.deepEqual(parseItemRequest(["828", "raw"]), { kind: "raw", id: 828 });
  assert.deepEqual(parseItemRequest(["828", "other"]), { kind: "usage" });

  const names = parseItemNameCsv("828,レアチケット販売,価格,税込\n");
  assert.deepEqual(names.get(828), {
    name: "レアチケット販売",
    detail: "価格,税込",
  });

  const valid = createEntry();
  assert.equal(parseItemJson({ updatedAt: "test", data: [valid] }).data.length, 1);
  assert.throws(
    () => parseItemJson({
      data: [{ ...valid, header: { ...valid.header, startTime: "2500" } }],
    }),
    /startTime is not a valid time/,
  );
});

test("item schedule follows sale grouping and includes 301 and 302", () => {
  const entries = [
    createEntry({ giftType: 301, eventId: 1, title: "注釈タイトル" }),
    createEntry({
      startDate: "20260106",
      startTime: "1100",
      endTime: "1200",
      giftAmount: 2,
      title: "一覧用タイトル",
    }),
    createEntry({
      startDate: "20260120",
      endDate: "20260122",
      giftType: 302,
      eventId: 2,
      title: "別の注釈",
    }),
    createEntry({
      startDate: "20260120",
      endDate: "20300101",
      giftType: 301,
      eventId: 3,
    }),
    createEntry({
      startDate: "20250101",
      endDate: "20250102",
      giftType: 828,
      eventId: 4,
    }),
  ];
  const output = formatItemSchedule(
    createDisplayData(entries),
    new Date("2026-01-07T00:00:00.000Z"),
  );

  assert.equal((output.match(/🟢 \[~1\/10\(土\) 10:00\]/g) ?? []).length, 1);
  assert.match(output, /301 ガチャ半額リセット（単発）/);
  assert.match(output, /828 一覧用タイトル ×2/);
  assert.match(output, /\[1\/20\(火\) 10:00~\]/);
  assert.match(output, /302 ガチャ半額リセット（11連）/);
  assert.doesNotMatch(output, /2030|eventId: 3/);
  assert.doesNotMatch(output, /🟠|\n\n\[/);
});

test("item detail keeps the legacy fields and adds sanitized gift detail", () => {
  const entry = createEntry({
    startDate: "20260901",
    startTime: "000",
    endDate: "20260902",
    endTime: "000",
  });
  const data = createDisplayData([entry]);
  const output = formatItemDetail(entry, data);

  assert.match(output, /^レアチケット販売\n2026年9月1日\(火\) 00:00 ~ 2026年9月2日\(水\) 00:00/);
  assert.match(output, /ver\.150501~999999\neventId: 51754\ngiftType: 828/);
  assert.match(output, /ギフト詳細\n・レアチケット 1枚\n・価格：160円 & 税込/);
  assert.doesNotMatch(output, /<b>|<br|<i>/);

  const search = searchItemEntries(51754, data.item);
  assert.equal(search.searchedByEventId, true);
  assert.equal(search.entries.length, 1);
});

test("eventId detail notifies the fallback and JSON returns every matching entry", async () => {
  const entries = [
    createEntry(),
    createEntry({ startDate: "20260201", eventId: 60000, raw: "raw\tsecond" }),
  ];
  const data = createDisplayData(entries);
  const dataSource = {
    async fetchItemJson() { return data.item; },
    async fetchDisplayData() { return data; },
  };
  const command = createItemCommand({
    dataSource,
    now: () => new Date(0),
  });
  const context = { inGuild: true, async reply() {} };

  const detailOutput = createFakeOutput();
  await command.execute({ ...context, interactive: detailOutput }, ["51754"]);
  assert.equal(detailOutput.messages.length, 2);
  assert.match(detailOutput.messages[0].content, /eventID で検索しました/);
  assert.match(detailOutput.messages[1].content, /レアチケット販売/);

  const jsonOutput = createFakeOutput();
  await command.execute({ ...context, interactive: jsonOutput }, ["828", "json"]);
  assert.equal(jsonOutput.messages.length, 2);
  assert.doesNotMatch(jsonOutput.messages[0].content, /"raw"/);
  assert.doesNotMatch(jsonOutput.messages[1].content, /"raw"/);
});
