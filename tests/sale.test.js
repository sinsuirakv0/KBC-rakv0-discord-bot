const assert = require("node:assert/strict");
const test = require("node:test");

const { createSaleCommand } = require("../dist/commands/sale/command");
const {
  findNameMatches,
  getStageName,
  isMissionId,
  parseSaleRequest,
} = require("../dist/commands/sale/domain");
const {
  formatDuration,
  formatEntryDetail,
  formatSchedule,
  parseHeaderDate,
} = require("../dist/commands/sale/formatters");
const { splitTextIntoChunks } = require("../dist/commands/sale/messaging");
const {
  parseAllDayEventTsv,
  parseCardSetting,
  parseSaleJson,
} = require("../dist/commands/sale/parsers");

function createEntry({
  startDate = "20260101",
  startTime = "0000",
  endDate = "20260101",
  endTime = "0130",
  stageIds = [102],
  raw = "raw\tvalue",
  timeBlocks = [],
} = {}) {
  return {
    header: {
      startDate,
      startTime,
      endDate,
      endTime,
      minVersion: "10000",
      maxVersion: "999999",
    },
    timeBlocks,
    stageIds,
    raw,
  };
}

function createDisplayData(entries) {
  return {
    sale: { updatedAt: "test", data: entries },
    saleNames: new Map([
      [102, "代表ステージ"],
      [999, "対象ステージA"],
      [555, "同時刻ステージ"],
      [556, "終了日時違いステージ"],
      [8000, "検索に出してはいけないミッション"],
    ]),
    allDayEventNames: new Map([
      [777, "補完ステージ"],
      [778, "補完ステージB"],
    ]),
    missionNames: new Map([[8000, "ミッション名,説明文"]]),
    cardSettingStageIds: [102, 112],
  };
}

function createFakeOutput(selectedEmoji) {
  const messages = [];
  return {
    userId: "user-1",
    messages,
    async send(content) {
      const message = {
        content,
        edits: [],
        deleted: false,
        reactions: [],
        waitArguments: undefined,
        async edit(nextContent) {
          this.edits.push(nextContent);
          this.content = nextContent;
        },
        async delete() {
          this.deleted = true;
        },
        async react(emoji) {
          this.reactions.push(emoji);
        },
        async waitForUserReaction(emojis, userId, timeoutMs) {
          this.waitArguments = { emojis, userId, timeoutMs };
          return selectedEmoji;
        },
      };
      messages.push(message);
      return message;
    },
  };
}

test("sale request parser keeps detail, JSON, Raw, and name search forms", () => {
  assert.deepEqual(parseSaleRequest([]), { kind: "schedule" });
  assert.deepEqual(parseSaleRequest(["102"]), { kind: "detail", id: 102 });
  assert.deepEqual(parseSaleRequest(["102", "j"]), { kind: "json", id: 102 });
  assert.deepEqual(parseSaleRequest(["102", "JSON"]), { kind: "json", id: 102 });
  assert.deepEqual(parseSaleRequest(["102", "r"]), { kind: "raw", id: 102 });
  assert.deepEqual(parseSaleRequest(["102", "RAW"]), { kind: "raw", id: 102 });
  assert.deepEqual(parseSaleRequest(["補完", "ステージ"]), {
    kind: "search",
    query: "補完 ステージ",
  });
});

test("duration uses whole days, hours, and minutes and floors seconds", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    formatDuration(start, new Date("2026-01-01T01:30:59.999Z")),
    "<1h30m>",
  );
  assert.equal(
    formatDuration(start, new Date("2026-01-03T00:05:00.000Z")),
    "<2d5m>",
  );
  assert.equal(formatDuration(start, start), "<0m>");
});

test("schedule hides missions and permanent entries and applies representative and fallback names", () => {
  const entries = [
    createEntry({ stageIds: [999, 102] }),
    createEntry({ stageIds: [555] }),
    createEntry({
      startDate: "20260102",
      startTime: "1000",
      endDate: "20260104",
      endTime: "1000",
      stageIds: [777, 778],
    }),
    createEntry({
      startDate: "20260102",
      endDate: "20260103",
      stageIds: [8000],
    }),
    createEntry({ endDate: "20300101", endTime: "0000", stageIds: [777] }),
  ];
  const now = new Date("2025-12-31T15:30:00.000Z");
  const output = formatSchedule(createDisplayData(entries), now);

  assert.match(output, /🟢 \[~1\/1\(木\) 01:30\]/);
  assert.equal((output.match(/🟢 \[~1\/1\(木\) 01:30\]/g) ?? []).length, 1);
  assert.doesNotMatch(output, /🟢 <1h30m>/);
  assert.match(output, /102 代表ステージ <1h30m>/);
  assert.match(output, /555 同時刻ステージ <1h30m>/);
  assert.doesNotMatch(output, /999 対象ステージA/);
  assert.match(output, /\[1\/2\(金\) 10:00~\]/);
  assert.doesNotMatch(output, /\n\n\[/);
  assert.doesNotMatch(output, /🟠/);
  assert.match(output, /777 補完ステージ <2d>/);
  assert.match(output, /778 補完ステージB <2d>/);
  assert.doesNotMatch(output, /8000/);
  assert.doesNotMatch(output, /2030/);
});

test("schedule groups entries with the same start date despite different end dates and times", () => {
  const entries = [
    createEntry({
      startDate: "20260105",
      startTime: "1000",
      endDate: "20260110",
      endTime: "1000",
      stageIds: [555],
    }),
    createEntry({
      startDate: "20260105",
      startTime: "1100",
      endDate: "20260111",
      endTime: "1200",
      stageIds: [556],
    }),
  ];
  const output = formatSchedule(
    createDisplayData(entries),
    new Date("2026-01-07T00:00:00.000Z"),
  );

  assert.equal((output.match(/🟢 \[~1\/10\(土\) 10:00\]/g) ?? []).length, 1);
  assert.match(output, /555 同時刻ステージ <5d>/);
  assert.match(output, /556 終了日時違いステージ <6d1h>/);
});

test("schedule groups entries with the same end date despite different start dates", () => {
  const entries = [
    createEntry({
      startDate: "20260105",
      startTime: "1000",
      endDate: "20260110",
      endTime: "1000",
      stageIds: [555],
    }),
    createEntry({
      startDate: "20260106",
      startTime: "1100",
      endDate: "20260110",
      endTime: "1200",
      stageIds: [556],
    }),
  ];
  const output = formatSchedule(
    createDisplayData(entries),
    new Date("2025-12-31T00:00:00.000Z"),
  );

  assert.equal((output.match(/\[1\/5\(月\) 10:00~\]/g) ?? []).length, 1);
  assert.match(output, /555 同時刻ステージ <5d>/);
  assert.match(output, /556 終了日時違いステージ <4d1h>/);
});

test("detail exposes target stages and direct mission names", () => {
  const data = createDisplayData([]);
  const representativeDetail = formatEntryDetail(
    createEntry({ stageIds: [999, 102] }),
    data,
    data.cardSettingStageIds,
    102,
  );
  assert.match(representativeDetail, /^102 代表ステージ/m);
  assert.match(representativeDetail, /対象ステージ: 999 対象ステージA/);

  const selectedDetail = formatEntryDetail(
    createEntry({ stageIds: [999, 102] }),
    data,
    data.cardSettingStageIds,
    999,
  );
  assert.match(selectedDetail, /^999 対象ステージA/m);
  assert.doesNotMatch(selectedDetail, /102 代表ステージ/);

  assert.equal(isMissionId(8000), true);
  assert.equal(isMissionId(15005), true);
  assert.equal(isMissionId(16000), false);
  assert.equal(
    getStageName(15005, {
      saleNames: new Map(),
      allDayEventNames: new Map(),
      missionNames: new Map([[5, "オフセットミッション,説明"]]),
    }),
    "オフセットミッション",
  );
});

test("name search gives sale_name priority, includes TSV fallback, and excludes missions", () => {
  const saleNames = new Map([
    [102, "優先名"],
    [8000, "ミッション検索語"],
  ]);
  const fallbackNames = new Map([
    [102, "使われない補完名"],
    [777, "補完検索語<br>表示"],
  ]);

  assert.deepEqual(findNameMatches("優先", saleNames, fallbackNames), [[102, "優先名"]]);
  assert.deepEqual(findNameMatches("補完検索", saleNames, fallbackNames), [
    [777, "補完検索語 表示"],
  ]);
  assert.deepEqual(findNameMatches("ミッション", saleNames, fallbackNames), []);
});

test("parsers preserve cardsetting order, TSV columns, and reject malformed sale data", () => {
  assert.deepEqual(parseCardSetting("102, 112, # note\n// 999\n112, 200"), [
    102,
    112,
    200,
  ]);
  assert.deepEqual(
    [...parseAllDayEventTsv("補完名\t777\textra\n// comment\n").entries()],
    [[777, "補完名"]],
  );
  assert.throws(() => parseSaleJson({ data: [{ header: null }] }), /Invalid sale data/);
});

test("JSON removes raw and Raw replaces tabs without network access", async () => {
  const sale = { updatedAt: "test", data: [createEntry()] };
  const dataSource = {
    async fetchSaleJson() {
      return sale;
    },
    async fetchDisplayData() {
      throw new Error("display data must not be requested");
    },
  };
  const command = createSaleCommand({
    dataSource,
    now: () => new Date(0),
  });
  const baseContext = { inGuild: true, async reply() {} };

  const jsonOutput = createFakeOutput();
  await command.execute({ ...baseContext, interactive: jsonOutput }, ["102", "json"]);
  assert.equal(jsonOutput.messages.length, 1);
  assert.match(jsonOutput.messages[0].content, /^```json/);
  assert.doesNotMatch(jsonOutput.messages[0].content, /"raw"/);

  const rawOutput = createFakeOutput();
  await command.execute({ ...baseContext, interactive: rawOutput }, ["102", "raw"]);
  assert.equal(rawOutput.messages.length, 1);
  assert.match(rawOutput.messages[0].content, /raw {4}value/);
  assert.doesNotMatch(rawOutput.messages[0].content, /\t/);
});

test("name search keeps nine-result reaction mapping and thirty-second wait", async () => {
  const entries = [createEntry({ stageIds: [777] })];
  const data = createDisplayData(entries);
  const command = createSaleCommand({
    dataSource: {
      async fetchSaleJson() {
        return data.sale;
      },
      async fetchDisplayData() {
        return data;
      },
    },
    now: () => new Date(0),
  });
  const output = createFakeOutput("1️⃣");
  await command.execute(
    { inGuild: true, async reply() {}, interactive: output },
    ["補完"],
  );

  const resultMessage = output.messages[0];
  assert.deepEqual(resultMessage.reactions, ["1️⃣", "2️⃣"]);
  assert.deepEqual(resultMessage.waitArguments, {
    emojis: ["1️⃣", "2️⃣"],
    userId: "user-1",
    timeoutMs: 30_000,
  });
  assert.match(output.messages[1].content, /777 補完ステージ/);
});

test("message splitting handles a single overlong line", () => {
  const chunks = splitTextIntoChunks("x".repeat(3_701), 1_800);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [1_800, 1_800, 101]);
  assert.equal(chunks.join(""), "x".repeat(3_701));
});

test("external data failures become a user-facing error", async () => {
  const command = createSaleCommand({
    dataSource: {
      async fetchSaleJson() {
        throw new Error("offline");
      },
      async fetchDisplayData() {
        throw new Error("offline");
      },
    },
    now: () => new Date(0),
  });
  const output = createFakeOutput();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await command.execute(
      { inGuild: true, async reply() {}, interactive: output },
      [],
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(output.messages[0].content, "❌ データ取得に失敗しました");
});
